/**
 * x.script.js
 * 分離されたスクリプト：x.cleaned.html の <script> 部分を別ファイル化しました。
 * （最大いいね / 最大リツイートの UI を削除に合わせ、スクリプト側からも参照を除去しています）
 */

const ICON_EXPANDED = 'image/close.png';
const ICON_COLLAPSED = 'image/open.png';
const STORAGE_KEY = 'xsearch_state_v3';
const SAVE_DEBOUNCE_MS = 200;
const OPEN_PREF_KEY = 'x_open_pref_v1';
const DEFAULT_OPEN_MODE = 'auto';
const OPEN_APP_TIMEOUT_MS = 1200;

function debounce(fn, ms){ let t; return function(){ clearTimeout(t); t = setTimeout(fn, ms); } }
function splitTrim(s){ return s? String(s).trim().split(/\s+/).filter(x=>x):[] }
function isNumeric(s){ return String(s).trim()!=='' && /^[0-9]+$/.test(String(s).trim()) }
function collapseSpaces(str){ return String(str||'').split(/\s+/).filter(x=>x && x.length>0).join(' ') }

function escapeHtml(str){
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getStoredOpenMode(){
  try {
    var v = localStorage.getItem(OPEN_PREF_KEY);
    if (v === 'auto' || v === 'app' || v === 'browser') return v;
  } catch(e) {}
  return DEFAULT_OPEN_MODE;
}

function getOpenMode(){
  try {
    var selected = document.querySelector('input[name="open_mode"]:checked');
    if (selected && selected.value) return selected.value;
  } catch(e) {}
  return getStoredOpenMode();
}

function setOpenMode(mode, opts){
  var v = (mode === 'app' || mode === 'browser' || mode === 'auto') ? mode : DEFAULT_OPEN_MODE;
  if (!opts || !opts.skipSave) {
    try { localStorage.setItem(OPEN_PREF_KEY, v); } catch(e) {}
  }
  try {
    var el = document.getElementById('open_mode_' + v);
    if (el) el.checked = true;
  } catch(e) {}
}

function getDeviceInfo(){
  var ua = navigator.userAgent || '';
  var uaData = navigator.userAgentData || null;
  var isAndroid = /Android/i.test(ua);
  var isIOS = /iPhone|iPad|iPod/i.test(ua);
  var isMobile = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua) || (uaData && uaData.mobile === true);
  var isChrome = /Chrome|CriOS/i.test(ua) && !/Edg|OPR|SamsungBrowser/i.test(ua);
  return { isAndroid: isAndroid, isIOS: isIOS, isMobile: isMobile, isChrome: isChrome };
}

function openInBrowser(url){
  try {
    var w = window.open(url, '_blank');
    if (!w) window.location.href = url;
  } catch(e) {
    window.location.href = url;
  }
}

function buildAppTargets(query, webUrl, opts){
  var encoded = encodeURIComponent(query || '');
  var twitterScheme = 'twitter://search?query=' + encoded;
  var xScheme = 'x://search?query=' + encoded;
  var includeFallback = !!(opts && opts.includeFallback);
  var intentUrl = 'intent://search?query=' + encoded + '#Intent;scheme=twitter;package=com.twitter.android;'
    + (includeFallback ? ('S.browser_fallback_url=' + encodeURIComponent(webUrl) + ';') : '')
    + 'end';
  return { schemes: [twitterScheme, xScheme], intentUrl: intentUrl };
}

function tryOpenSchemes(schemes, webUrl){
  var index = 0;
  var opened = false;
  function attempt(){
    if (index >= schemes.length) {
      if (!opened && webUrl) openInBrowser(webUrl);
      return;
    }
    var scheme = schemes[index++];
    var timer = null;
    function cleanup(){ if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); }
    function onVis(){ if (document.hidden) { opened = true; cleanup(); } }
    document.addEventListener('visibilitychange', onVis);
    try { window.location.href = scheme; } catch(e) { /* ignore */ }
    timer = setTimeout(function(){ cleanup(); if (!opened) attempt(); }, OPEN_APP_TIMEOUT_MS);
  }
  attempt();
}

function openAppOrFallback(query, webUrl){
  var device = getDeviceInfo();
  if (!device.isMobile) return openInBrowser(webUrl);
  var targets = buildAppTargets(query, webUrl, { includeFallback: true });
  if (device.isAndroid && device.isChrome && targets.intentUrl) {
    var timer = null;
    var opened = false;
    function cleanup(){ if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); }
    function onVis(){ if (document.hidden) { opened = true; cleanup(); } }
    document.addEventListener('visibilitychange', onVis);
    try { window.location.href = targets.intentUrl; } catch(e) { /* ignore */ }
    timer = setTimeout(function(){ cleanup(); if (!opened) openInBrowser(webUrl); }, OPEN_APP_TIMEOUT_MS);
    return;
  }
  tryOpenSchemes(targets.schemes, webUrl);
}

function openAppOnly(query, webUrl){
  if (!confirm('xを開きますか？')) return;
  var device = getDeviceInfo();
  if (!device.isMobile) return;
  var targets = buildAppTargets(query, webUrl, { includeFallback: false });
  if (device.isAndroid && device.isChrome && targets.intentUrl) {
    try { window.location.href = targets.intentUrl; } catch(e) { /* ignore */ }
    return;
  }
  tryOpenSchemes(targets.schemes, null);
}

function openSearchWithPreference(query){
  var url = buildSearchURL ? buildSearchURL(query) : ('https://x.com/search?q=' + encodeURIComponent(query));
  var mode = getOpenMode();
  if (mode === 'browser') return openInBrowser(url);
  if (mode === 'app') return openAppOnly(query, url);
  var device = getDeviceInfo();
  if (device.isMobile) return openAppOrFallback(query, url);
  return openInBrowser(url);
}

function buildQueryAnalysis(query){
  var q = String(query || '').trim();
  if (!q) return '<div>クエリが空です。</div>';

  function tokenize(input){
    return (String(input || '').match(/"[^"]+"|\(|\)|\S+/g) || []).filter(Boolean);
  }

  function splitByTopLevelOr(input){
    var tokens = tokenize(input);
    var groups = [];
    var current = [];
    var depth = 0;
    tokens.forEach(function(t){
      if (t === '(') { depth++; current.push(t); return; }
      if (t === ')') { depth = Math.max(0, depth - 1); current.push(t); return; }
      if (t === 'OR' && depth === 0) {
        groups.push(current.join(' ').trim());
        current = [];
        return;
      }
      current.push(t);
    });
    if (current.length) groups.push(current.join(' ').trim());
    return groups.filter(function(g){ return g; });
  }

  function extractInfo(input){
    var phrases = [];
    var m;
    var phraseRegex = /"([^"]+)"/g;
    while ((m = phraseRegex.exec(input)) !== null) phrases.push(m[1]);

    var from = [], to = [], mentions = [], hashtags = [], langs = [];
    var filtersInclude = [], filtersExclude = [];
    var urlsInclude = [], urlsExclude = [];
    var mins = [];
    var since = null, until = null;
    var excludeWords = [];
    var keywords = [];

    var tokens = tokenize(input);
    tokens.forEach(function(t){
      if (t === 'OR') return;
      if (t === '(' || t === ')') return;
      if (t.startsWith('"') && t.endsWith('"')) return;

      var lower = t.toLowerCase();
      var neg = lower.startsWith('-');
      var raw = neg ? t.slice(1) : t;
      var rawLower = raw.toLowerCase();

      if (rawLower.startsWith('from:')) { from.push(raw.slice(5)); return; }
      if (rawLower.startsWith('to:')) { to.push(raw.slice(3)); return; }
      if (rawLower.startsWith('lang:')) { langs.push(raw.slice(5)); return; }
      if (rawLower.startsWith('since:')) { since = raw.slice(6); return; }
      if (rawLower.startsWith('until:')) { until = raw.slice(6); return; }
      if (rawLower.startsWith('min_faves:') || rawLower.startsWith('min_retweets:') || rawLower.startsWith('min_replies:')) { mins.push({ raw: raw, neg: neg }); return; }
      if (rawLower.startsWith('filter:')) { var f = raw.slice(7); if (neg) filtersExclude.push(f); else filtersInclude.push(f); return; }
      if (rawLower.startsWith('url:')) { var u = raw.slice(4); if (neg) urlsExclude.push(u); else urlsInclude.push(u); return; }
      if (raw.startsWith('@') && raw.length > 1) { mentions.push(raw.slice(1)); return; }
      if (raw.startsWith('#') && raw.length > 1) { hashtags.push(raw.slice(1)); return; }
      if (neg && raw && raw.indexOf(':') === -1) { excludeWords.push(raw); return; }
      keywords.push(raw);
    });

    return {
      phrases: phrases,
      keywords: keywords,
      excludeWords: excludeWords,
      from: from,
      to: to,
      mentions: mentions,
      hashtags: hashtags,
      langs: langs,
      since: since,
      until: until,
      mins: mins,
      filtersInclude: filtersInclude,
      filtersExclude: filtersExclude,
      urlsInclude: urlsInclude,
      urlsExclude: urlsExclude
    };
  }

  var info = extractInfo(q);

  function joinList(arr){ return arr.join(' / '); }
  function describeFilters(list){
    return list.map(function(f){
      var key = f.toLowerCase();
      if (key === 'media') return '画像・動画のみ';
      if (key === 'images') return '画像のみ';
      if (key === 'videos') return '動画のみ';
      if (key === 'links') return 'リンクを含む';
      if (key === 'replies') return 'リプライのみ';
      if (key === 'quote') return '引用のみ';
      if (key === 'verified') return '認証済みのみ';
      if (key === 'follows') return 'フォロー中のみ';
      return f + ' を条件に追加';
    }).join(' / ');
  }
  function describeExcludeFilters(list){
    return list.map(function(f){
      var key = f.toLowerCase();
      if (key === 'media') return '画像・動画を除く';
      if (key === 'images') return '画像を除く';
      if (key === 'videos') return '動画を除く';
      if (key === 'links') return 'リンクを除く';
      if (key === 'replies') return 'リプライを除く';
      if (key === 'quote') return '引用を除く';
      if (key === 'verified') return '認証済みを除く';
      return f + ' を除く';
    }).join(' / ');
  }
  function describeMin(item){
    var raw = item.raw || '';
    var neg = !!item.neg;
    var parts = raw.split(':');
    var key = (parts[0] || '').toLowerCase();
    var val = parts[1] || '';
    var label = key === 'min_faves' ? 'いいね' : (key === 'min_retweets' ? 'リツイート' : 'リプライ');
    if (!val) return label + '条件';
    return label + (neg ? (' ' + val + ' 以下') : (' ' + val + ' 以上'));
  }

  var lines = [];
  if (info.phrases.length) lines.push('フレーズ完全一致: ' + joinList(info.phrases) + ' を含む');
  if (info.keywords.length) lines.push('キーワード: ' + joinList(info.keywords) + ' を含む');
  if (info.excludeWords.length) lines.push('除外ワード: ' + joinList(info.excludeWords) + ' を除く');
  if (info.from.length) lines.push('投稿者指定: ' + joinList(info.from) + ' の投稿のみ');
  if (info.to.length) lines.push('返信先指定: ' + joinList(info.to) + ' 宛ての返信のみ');
  if (info.mentions.length) lines.push('メンション: @' + joinList(info.mentions) + ' を含む');
  if (info.hashtags.length) lines.push('ハッシュタグ: #' + joinList(info.hashtags) + ' を含む');
  if (info.langs.length) lines.push('言語指定: ' + joinList(info.langs) + ' の投稿');
  if (info.since || info.until) lines.push('期間: ' + (info.since ? ('since:' + info.since) : '') + (info.since && info.until ? ' 〜 ' : '') + (info.until ? ('until:' + info.until) : ''));
  if (info.mins.length) lines.push('エンゲージ条件: ' + joinList(info.mins.map(describeMin)));
  if (info.filtersInclude.length) lines.push('フィルター: ' + describeFilters(info.filtersInclude));
  if (info.filtersExclude.length) lines.push('除外フィルター: ' + describeExcludeFilters(info.filtersExclude));
  if (info.urlsInclude.length) lines.push('URL含む: ' + joinList(info.urlsInclude) + ' を含む');
  if (info.urlsExclude.length) lines.push('URL除外: ' + joinList(info.urlsExclude) + ' を除く');

  var orGroups = splitByTopLevelOr(q);
  if (orGroups.length > 1) {
    lines.push('OR 条件: 以下のいずれかに一致');
  }

  if (lines.length === 0) lines.push('条件が読み取れませんでした。クエリの形式を確認してください。');

  var html = '<div><b>検索結果の傾向</b></div><ul>';
  lines.forEach(function(line){ html += '<li>' + escapeHtml(line) + '</li>'; });
  html += '</ul>';
  if (orGroups.length > 1) {
    html += '<div style="margin-top:6px"><b>OR 条件の詳細</b></div><ul>';
    orGroups.forEach(function(g, idx){
      var gi = extractInfo(g);
      var parts = [];
      if (gi.phrases.length) parts.push('フレーズ完全一致: ' + joinList(gi.phrases) + ' を含む');
      if (gi.keywords.length) parts.push('キーワード: ' + joinList(gi.keywords) + ' を含む');
      if (gi.excludeWords.length) parts.push('除外ワード: ' + joinList(gi.excludeWords) + ' を除く');
      if (gi.from.length) parts.push('投稿者指定: ' + joinList(gi.from) + ' の投稿のみ');
      if (gi.to.length) parts.push('返信先指定: ' + joinList(gi.to) + ' 宛ての返信のみ');
      if (gi.mentions.length) parts.push('メンション: @' + joinList(gi.mentions) + ' を含む');
      if (gi.hashtags.length) parts.push('ハッシュタグ: #' + joinList(gi.hashtags) + ' を含む');
      if (gi.langs.length) parts.push('言語指定: ' + joinList(gi.langs) + ' の投稿');
      if (gi.mins.length) parts.push('エンゲージ条件: ' + joinList(gi.mins.map(describeMin)));
      if (gi.filtersInclude.length) parts.push('フィルター: ' + describeFilters(gi.filtersInclude));
      if (gi.filtersExclude.length) parts.push('除外フィルター: ' + describeExcludeFilters(gi.filtersExclude));
      if (gi.urlsInclude.length) parts.push('URL含む: ' + joinList(gi.urlsInclude) + ' を含む');
      if (gi.urlsExclude.length) parts.push('URL除外: ' + joinList(gi.urlsExclude) + ' を除く');
      if (gi.since || gi.until) parts.push('期間: ' + (gi.since ? ('since:' + gi.since) : '') + (gi.since && gi.until ? ' 〜 ' : '') + (gi.until ? ('until:' + gi.until) : ''));
      var detail = parts.length ? parts.join(' / ') : '条件なし';
      html += '<li>ORグループ' + (idx + 1) + ': ' + escapeHtml(detail) + '</li>';
    });
    html += '</ul>';
  }
  return html;
}

let scheduleSaveState = function(){};
let userEditedQuery = false;
let manualQueryOverride = null;

function syncTriToggleUI(){
  try{
    document.querySelectorAll('.tri-toggle').forEach(function(toggle){
      var filter = toggle.dataset.filter;
      var onlyEl = document.getElementById('only_' + filter);
      var excludeEl = document.getElementById('exclude_' + filter);
      var state = 'none';
      if (onlyEl && onlyEl.checked) state = 'only';
      else if (excludeEl && excludeEl.checked) state = 'exclude';
      toggle.querySelectorAll('button').forEach(function(btn){
        btn.classList.remove('active-none','active-only','active-exclude');
        if (btn.dataset.val === state) btn.classList.add('active-' + state);
      });
    });
  } catch(e){ console.warn('syncTriToggleUI failed', e); }
}

// element map (max fields removed)
const E = {
  phrase_input: document.getElementById('q_phrase_input'),
  phrase_list_hidden: document.getElementById('q_phrase_list'),
  phrase_container: document.getElementById('phrase_list'),
  btn_add_phrase: document.getElementById('btn_add_phrase'),


  from: document.getElementById('q_from'),
  to: document.getElementById('q_to'),
  at_search: document.getElementById('q_at_search'),
  only_verified: document.getElementById('only_verified'),
  exclude_verified: document.getElementById('exclude_verified'),
  only_following: document.getElementById('only_following'),

  since_date: document.getElementById('q_since_date'),
  until_date: document.getElementById('q_until_date'),

  min_likes: document.getElementById('q_min_likes'),
  min_retweets: document.getElementById('q_min_retweets'),

  lang_select: document.getElementById('q_lang_select'),
  tab_top: document.getElementById('tab_top'),
  tab_latest: document.getElementById('tab_latest'),
  tab_media: document.getElementById('tab_media'),

  only_replies: document.getElementById('only_replies'),
  exclude_replies: document.getElementById('exclude_replies'),
  only_quote: document.getElementById('only_quote'),
  exclude_quote: document.getElementById('exclude_quote'),
  only_links: document.getElementById('only_links'),
  exclude_links: document.getElementById('exclude_links'),
  only_media: document.getElementById('only_media'),
  exclude_media: document.getElementById('exclude_media'),
  only_images: document.getElementById('only_images'),
  exclude_images: document.getElementById('exclude_images'),
  only_videos: document.getElementById('only_videos'),
  exclude_videos: document.getElementById('exclude_videos'),

  misc: document.getElementById('q_misc'),

  btn_search: document.getElementById('btn_search'),
  btn_reset: document.getElementById('btn_reset'),
  
  top_query_display: document.getElementById('top_query_display'),
  top_btn_search: document.getElementById('top_btn_search'),
  top_btn_reset: document.getElementById('top_btn_reset')
};

const COLLAPSIBLE_SETTERS = {};
const DEFAULT_COLLAPSED_MAP = {
  collapse_basic: false,
  collapse_account: false,
  collapse_period: false,
  collapse_engagement: false,
  collapse_other: false,
  collapse_type: false
};

// populate date selects (removed, now using text boxes for yymmdd)

// Convert yymmdd to YYYY-MM-DD
function convertYYMMDDtoDate(str) {
  if (!str || str.trim().length !== 6) return '';
  const yy = str.substr(0, 2);
  const mm = str.substr(2, 2);
  const dd = str.substr(4, 2);
  const year = (parseInt(yy, 10) < 50 ? '20' : '19') + yy;
  return year + '-' + mm + '-' + dd;
}

// icon fallback
function svgFallbackDataUrl(label){ const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'><rect rx='10' width='64' height='64' fill='#e6fbfa'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Arial,Helvetica,sans-serif' font-size='20' fill='#073a46'>${label}</text></svg>`; return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg); }
function ensureIconFallbacks(){ document.querySelectorAll('.collapsible-header img.icon').forEach(function(img){ img.onerror = function(){ img.onerror = null; img.src = svgFallbackDataUrl('X'); }; if(img.complete && img.naturalWidth === 0) img.onerror(); }); }

// setup collapsibles (robust)
(function setupCollapsibles(){
  ensureIconFallbacks();
  document.querySelectorAll('.collapse-group').forEach(function(group){
    const header = group.querySelector('.collapsible-header');
    const icon = header && header.querySelector('img.icon');
    const gid = group.id;
    const dataIconExpanded = header && header.getAttribute('data-icon-expanded');
    const dataIconCollapsed = header && header.getAttribute('data-icon-collapsed');
    const iconExpandedSrc = dataIconExpanded || ICON_EXPANDED;
    const iconCollapsedSrc = dataIconCollapsed || ICON_COLLAPSED;
    const defaultCollapsed = (typeof DEFAULT_COLLAPSED_MAP[gid] !== 'undefined') ? DEFAULT_COLLAPSED_MAP[gid] : true;

    function setExpanded(expanded){
      if(expanded){
        group.classList.remove('collapsed');
        if(header && typeof header.setAttribute === 'function') header.setAttribute('aria-expanded','true');
        if(group && typeof group.setAttribute === 'function') group.setAttribute('aria-expanded','true');
        if(icon){ try{ icon.src = iconExpandedSrc; }catch(e){} }
      }
      else {
        group.classList.add('collapsed');
        if(header && typeof header.setAttribute === 'function') header.setAttribute('aria-expanded','false');
        if(group && typeof group.setAttribute === 'function') group.setAttribute('aria-expanded','false');
        if(icon){ try{ icon.src = iconCollapsedSrc; }catch(e){} }
      }
      scheduleSaveState();
    }

    COLLAPSIBLE_SETTERS[gid] = setExpanded;
    setExpanded(!defaultCollapsed);

    if(header){
      header.addEventListener('click', function(){ const isCollapsed = group.classList.contains('collapsed'); setExpanded(isCollapsed); });
      header.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); const isCollapsed = group.classList.contains('collapsed'); setExpanded(isCollapsed); }});
    }
  });
})();

// Exclusive checkbox binding
function bindExclusive(onlyEl, excludeEl){ if(!onlyEl || !excludeEl) return; onlyEl.addEventListener('change', function(){ if(onlyEl.checked){ excludeEl.checked = false; excludeEl.disabled = true; } else { excludeEl.disabled = false; } scheduleSaveState(); }); excludeEl.addEventListener('change', function(){ if(excludeEl.checked){ onlyEl.checked = false; onlyEl.disabled = true; } else { onlyEl.disabled = false; } scheduleSaveState(); }); }
bindExclusive(document.getElementById('only_replies'), document.getElementById('exclude_replies'));
bindExclusive(document.getElementById('only_quote'), document.getElementById('exclude_quote'));
bindExclusive(document.getElementById('only_links'), document.getElementById('exclude_links'));
bindExclusive(document.getElementById('only_media'), document.getElementById('exclude_media'));
bindExclusive(document.getElementById('only_images'), document.getElementById('exclude_images'));
bindExclusive(document.getElementById('only_videos'), document.getElementById('exclude_videos'));
bindExclusive(document.getElementById('only_verified'), document.getElementById('exclude_verified'));
bindExclusive(document.getElementById('only_following'), document.getElementById('exclude_following'));
// --- 以下は x.html のインラインスクリプトを統合したもの ---
document.addEventListener('DOMContentLoaded', function() {
  // プリセット機能
  var presets = JSON.parse(localStorage.getItem('x_presets') || '{}');
  function loadPresetTitles() {
    for (var i = 1; i <= 5; i++) {
      var row = document.querySelector('.preset-row[data-preset="' + i + '"]');
      if (row && presets[i] && presets[i].title) {
        row.querySelector('.preset-title').value = presets[i].title;
      }
    }
  }
  loadPresetTitles();

  document.querySelectorAll('.preset-save-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var row = btn.closest('.preset-row');
      var idx = row.getAttribute('data-preset');
      var title = row.querySelector('.preset-title').value;
      var formData = {};
      document.querySelectorAll('input[id^="q_"], select[id^="q_"]').forEach(function(el) {
        formData[el.id] = el.value;
      });
      presets[idx] = { title: title, data: formData };
      localStorage.setItem('x_presets', JSON.stringify(presets));
      alert('プリセット「' + title + '」を保存しました');
    });
  });

  document.querySelectorAll('.preset-load-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var row = btn.closest('.preset-row');
      var idx = row.getAttribute('data-preset');
      if (presets[idx] && presets[idx].data) {
        Object.keys(presets[idx].data).forEach(function(key) {
          var el = document.getElementById(key);
          if (el) el.value = presets[idx].data[key];
        });
        if (typeof updatePreview === 'function') updatePreview();
        alert('プリセット「' + presets[idx].title + '」を呼び出しました');
      } else {
        alert('このプリセットは保存されていません');
      }
    });
  });

  // 検索履歴機能
  var history = JSON.parse(localStorage.getItem('x_history') || '[]');
  function renderHistory() {
    var list = document.getElementById('history_list');
    list.innerHTML = '';
    history.slice(0, 30).forEach(function(item, idx) {
      var row = document.createElement('div');
      row.className = 'history-row';
      row.innerHTML = '<div class="history-date">' + item.date + '</div><div class="history-query">' + item.query + '</div>';
      row.addEventListener('click', function() {
        if (item.data) {
          if (!confirm('検索条件をこの履歴で上書きしますか？')) return;
          Object.keys(item.data).forEach(function(key) {
            var el = document.getElementById(key);
            if (el) {
              if (el.type === 'checkbox') el.checked = !!item.data[key];
              else el.value = item.data[key];
            }
          });
          userEditedQuery = false;
          manualQueryOverride = null;
          syncTriToggleUI();
          if (typeof updatePreview === 'function') updatePreview();
          document.getElementById('modal_history').classList.remove('active');
        }
      });
      list.appendChild(row);
    });
    if (history.length === 0) {
      list.innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px;">履歴はありません</div>';
    }
  }

  function addHistory(query, formData) {
    var now = new Date();
    var dateStr = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0');
    history.unshift({ date: dateStr, query: query, data: formData });
    if (history.length > 30) history = history.slice(0, 30);
    localStorage.setItem('x_history', JSON.stringify(history));
  }

  // 検索ボタン押下時に履歴追加
  var topSearchEl = document.getElementById('top_btn_search');
  if (topSearchEl) {
    topSearchEl.addEventListener('click', function() {
      // build current query (or use manual override) and add to history, then open search in new tab
      var query = (userEditedQuery && manualQueryOverride && manualQueryOverride.trim()) ? manualQueryOverride : buildQuery();
      if (query && query.trim()) {
        var formData = {};
          document.querySelectorAll('input[id^="q_"], select[id^="q_"], textarea[id^="q_"], input[id^="only_"], input[id^="exclude_"]').forEach(function(el) {
            formData[el.id] = (el.type === 'checkbox') ? el.checked : el.value;
          });
        addHistory(query, formData);
        try {
          openSearchWithPreference(query);
        } catch(e) { console.warn('open search failed', e); }
      } else {
        alert('検索クエリが空です');
      }
    });
  }

  var clearHistoryBtn = document.getElementById('btn_clear_history');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', function() {
      if (confirm('履歴を全て削除しますか？')) {
        history = [];
        localStorage.setItem('x_history', JSON.stringify(history));
        renderHistory();
      }
    });
  }

  // モーダル開閉
  var btnHistory = document.getElementById('btn_history');
  if (btnHistory) btnHistory.addEventListener('click', function() { renderHistory(); document.getElementById('modal_history').classList.add('active'); });
  var closeHistory = document.getElementById('close_history');
  if (closeHistory) closeHistory.addEventListener('click', function() { document.getElementById('modal_history').classList.remove('active'); });
  var closePreset = document.getElementById('close_preset');
  if (closePreset) closePreset.addEventListener('click', function() { document.getElementById('modal_preset').classList.remove('active'); });

  // プリセット編集モーダルハンドラ
  var closePresetEdit = document.getElementById('close_preset_edit');
  if (closePresetEdit) closePresetEdit.addEventListener('click', function() { document.getElementById('modal_preset_edit').classList.remove('active'); });
  var presetEditCancel = document.getElementById('preset_edit_cancel');
  if (presetEditCancel) presetEditCancel.addEventListener('click', function() { document.getElementById('modal_preset_edit').classList.remove('active'); });
  var presetEditSave = document.getElementById('preset_edit_save');
  if (presetEditSave) presetEditSave.addEventListener('click', function() {
    var idx = document.getElementById('preset_edit_idx').value;
    var newTitle = document.getElementById('preset_edit_title').value;
    var newQuery = document.getElementById('preset_edit_query').value;
    if (!idx) return;
    // parse query into form data (best effort: store raw query for display)
    if (!presets[idx]) presets[idx] = {};
    presets[idx].title = newTitle;
    presets[idx].rawQuery = newQuery;
    // update title input in preset list
    var row = document.querySelector('.preset-row[data-preset="' + idx + '"]');
    if (row) row.querySelector('.preset-title').value = newTitle;
    localStorage.setItem('x_presets', JSON.stringify(presets));
    document.getElementById('modal_preset_edit').classList.remove('active');
    alert('プリセット「' + newTitle + '」を保存しました');
  });
  // プリセットタイトルクリックで編集モーダルを開く
  document.querySelectorAll('.preset-row .preset-title').forEach(function(titleInput) {
    titleInput.style.cursor = 'pointer';
    titleInput.addEventListener('click', function(e) {
      e.stopPropagation();
      var row = titleInput.closest('.preset-row');
      var idx = row.getAttribute('data-preset');
      var preset = presets[idx] || {};
      document.getElementById('preset_edit_idx').value = idx;
      document.getElementById('preset_edit_title').value = preset.title || titleInput.value;
      // show raw query if available, else build from data
      var queryText = preset.rawQuery || '';
      if (!queryText && preset.data) {
        // attempt to rebuild query from saved form data
        Object.keys(preset.data).forEach(function(key) {
          var el = document.getElementById(key);
          if (el) el.value = preset.data[key];
        });
        if (typeof buildQuery === 'function') queryText = buildQuery();
      }
      document.getElementById('preset_edit_query').value = queryText;
      document.getElementById('modal_preset_edit').classList.add('active');
      // フォーカスを防止するためにアクティブ要素からフォーカスを外す
      if (document.activeElement) document.activeElement.blur();
    });
  });

  // モーダル背景クリックで閉じる
  document.querySelectorAll('.modal-overlay').forEach(function(modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) modal.classList.remove('active');
    });
  });

  // メニューボタンで特定入力をフォーカスする（基本検索を常設した際の挙動）
  document.querySelectorAll('.menu-btn[data-focus]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      var id = btn.getAttribute('data-focus');
      var el = document.getElementById(id);
      if (el) {
        try { el.focus(); } catch (er) {}
        if (typeof updatePreview === 'function') updatePreview();
      }
    });
  });

  // 検索クエリ全文表示モーダル: クリック or ダブルクリックで開く（編集時はダブルクリック）
  var modalQuery = document.getElementById('modal_query');
  var modalQueryText = document.getElementById('modal_query_text');
  var topQueryDisplay = document.getElementById('top_query_display');
  if (topQueryDisplay && modalQuery && modalQueryText) {
    var modalQueryAnalysis = document.getElementById('modal_query_analysis');
    var saveModalQuery = function(){
      var text = modalQueryText.value || '';
      var top = document.getElementById('top_query_display');
      if (top) {
        var trimmed = text.trim();
        top.textContent = trimmed || '（検索クエリがここに表示されます）';
        userEditedQuery = !!trimmed;
        manualQueryOverride = userEditedQuery ? trimmed : null;
        scheduleSaveState();
      }
    };
    var updateModalQueryAnalysis = function(){
      if (!modalQueryAnalysis) return;
      var text = modalQueryText.value || '';
      modalQueryAnalysis.innerHTML = buildQueryAnalysis(text);
    };
    topQueryDisplay.style.cursor = 'pointer';
    topQueryDisplay.addEventListener('click', function() {
      var q = topQueryDisplay.textContent || '';
      if (q.trim() && q !== '（検索クエリがここに表示されます）') {
        modalQueryText.value = q.trim();
        updateModalQueryAnalysis();
        modalQuery.classList.add('active');
      }
    });
    var closeQuery = document.getElementById('close_query');
    if (closeQuery) closeQuery.addEventListener('click', function() { saveModalQuery(); modalQuery.classList.remove('active'); });
    // モーダル内のコピーボタン
    var modalQueryCopy = document.getElementById('modal_query_copy');
    if (modalQueryCopy) {
      modalQueryCopy.addEventListener('click', function() {
        var text = modalQueryText.value || '';
        if (text.trim()) {
          navigator.clipboard.writeText(text).then(function() { alert('クエリをコピーしました'); });
        }
      });
    }
    // 保存ボタンは UI から削除されたため、個別のクリックハンドラは不要です。

    if (modalQueryText) {
      modalQueryText.addEventListener('input', function(){
        updateModalQueryAnalysis();
      });
    }

    modalQuery.addEventListener('click', function(e){
      if (e.target === modalQuery) {
        saveModalQuery();
        modalQuery.classList.remove('active');
      }
    });

      // 全選択ボタン（主にモバイル向け）
      var modalQuerySelect = document.getElementById('modal_query_select_all');
      if (modalQuerySelect) {
        modalQuerySelect.addEventListener('click', function() {
          try {
            if (modalQueryText) {
              modalQueryText.focus();
              modalQueryText.select();
              try { modalQueryText.setSelectionRange(0, modalQueryText.value.length); } catch(e){}
            }
          } catch(e) { console.warn('select all failed', e); }
        });
      }
  }

  // エンゲージボタン
  document.querySelectorAll('.engagement-buttons button').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var targetId = btn.getAttribute('data-target');
      var value = btn.getAttribute('data-value');
      var input = document.getElementById(targetId);
      if (input) {
        input.value = value;
        if (typeof updatePreview === 'function') updatePreview();
      }
    });
  });
  document.querySelectorAll('.engagement-reset-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var targetId = btn.getAttribute('data-reset');
      var input = document.getElementById(targetId);
      if (input) {
        input.value = '';
        if (typeof updatePreview === 'function') updatePreview();
      }
    });
  });

  // from/to/@/期間のリセットボタン（クエリも更新）
  document.querySelectorAll('[data-reset="q_from"], [data-reset="q_to"], [data-reset="q_at_search"], [data-reset="q_since_date"], [data-reset="q_until_date"]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var targetId = btn.getAttribute('data-reset');
      var input = document.getElementById(targetId);
      if (input) {
        input.value = '';
        if (typeof updatePreview === 'function') updatePreview();
      }
    });
  });

  // 期間指定ボタン（直近）
  document.querySelectorAll('.period-buttons button[data-period]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var period = btn.getAttribute('data-period');
      var now = new Date();
      var since = new Date();
      if (period === '1h') {
        since.setHours(now.getHours() - 1);
      } else if (period === '24h') {
        since.setDate(now.getDate() - 1);
      } else if (period === '7d') {
        since.setDate(now.getDate() - 7);
      } else if (period === '31d') {
        since.setDate(now.getDate() - 31);
      } else if (period === '180d') {
        since.setDate(now.getDate() - 180);
      } else if (period === '365d') {
        since.setDate(now.getDate() - 365);
      }
      var sinceStr = String(since.getFullYear()).slice(2) + String(since.getMonth() + 1).padStart(2, '0') + String(since.getDate()).padStart(2, '0');
      var untilDate = new Date(now);
      untilDate.setDate(now.getDate() + 1); // until is exclusive on X, advance 1 day so UI includes today
      var untilStr = String(untilDate.getFullYear()).slice(2) + String(untilDate.getMonth() + 1).padStart(2, '0') + String(untilDate.getDate()).padStart(2, '0');
      var sinceEl = document.getElementById('q_since_date');
      var untilEl = document.getElementById('q_until_date');
      if (sinceEl) sinceEl.value = sinceStr;
      if (untilEl) untilEl.value = untilStr;
      if (typeof updatePreview === 'function') updatePreview();
    });
  });

  // 期間指定ボタン（開始日から）
  document.querySelectorAll('.period-buttons button[data-period-from]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var periodFrom = btn.getAttribute('data-period-from');
      var sinceInput = document.getElementById('q_since_date');
      var sinceVal = sinceInput ? sinceInput.value.trim() : '';
      if (!sinceVal || sinceVal.length !== 6) {
        alert('開始日を先に入力してください（yymmdd形式）');
        return;
      }
      var yy = parseInt('20' + sinceVal.slice(0, 2), 10);
      var mm = parseInt(sinceVal.slice(2, 4), 10) - 1;
      var dd = parseInt(sinceVal.slice(4, 6), 10);
      var since = new Date(yy, mm, dd);
      if (isNaN(since.getTime())) {
        alert('開始日が無効です');
        return;
      }
      var until = new Date(since);
      if (periodFrom === '1d') {
        until.setDate(until.getDate() + 1);
      } else if (periodFrom === '24h') {
        until.setDate(until.getDate() + 1);
      } else if (periodFrom === '7d') {
        until.setDate(until.getDate() + 7);
      } else if (periodFrom === '31d') {
        until.setDate(until.getDate() + 31);
      } else if (periodFrom === '180d') {
        until.setDate(until.getDate() + 180);
      } else if (periodFrom === '365d') {
        until.setDate(until.getDate() + 365);
      }
      // advance one more day so that the UI's selected end date is included (since `until:` is exclusive)
      until.setDate(until.getDate() + 1);
      var untilStr = String(until.getFullYear()).slice(2) + String(until.getMonth() + 1).padStart(2, '0') + String(until.getDate()).padStart(2, '0');
      var untilEl = document.getElementById('q_until_date');
      if (untilEl) untilEl.value = untilStr;
      if (typeof updatePreview === 'function') updatePreview();
    });
  });
});

// Note: delegated fallback removed to avoid duplicate confirmations.

// モバイルでのスクロールを全体的に禁止する（タッチスクロール防止）
(function(){
  function enableMobileNoScroll(){
    try{
      var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints>0) || (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints>0);
      if(!isTouch) return;
      document.documentElement.classList.add('no-scroll-mobile');
      document.body.classList.add('no-scroll-mobile');
      // NOTE: touchmove の preventDefault はピンチズームの復帰を阻害するため無効化
    }catch(e){ console.warn('enableMobileNoScroll failed', e); }
  }
  if(document.readyState === 'complete' || document.readyState === 'interactive') enableMobileNoScroll(); else document.addEventListener('DOMContentLoaded', enableMobileNoScroll);
})();

// --- Query builder and preview updater ---
function buildQuery() {
  var parts = [];
  // phrases (space separated tokens) - OR, (), "" は引用符で囲まない
  var phraseInput = document.getElementById('q_phrase_input');
  var phraseRaw = (phraseInput && phraseInput.value) ? phraseInput.value.trim() : '';
  // トークン化（OR, 括弧, ダブルクォート付きワードを保持）
  var tokens = phraseRaw.match(/\(|\)|OR|"[^"]*"|[^\s()]+/gi) || [];
  if (tokens.length) {
    var processed = tokens.map(function(t) {
      var upper = t.toUpperCase();
      // OR, 括弧、既にダブルクォート付きはそのまま
      if (upper === 'OR' || t === '(' || t === ')') return t;
      if (t.startsWith('"') && t.endsWith('"')) return t;
      // 通常ワードはダブルクォートで囲む
      return '"' + t.replace(/"/g, '\\"') + '"';
    });
    parts.push(processed.join(' '));
  }

  // keywords


  // (除外ワード欄を削除したため、この部分は無効化されています)

  // accounts
  var fromEl = document.getElementById('q_from');
  var toEl = document.getElementById('q_to');
  var atSearchEl = document.getElementById('q_at_search');
  if (fromEl && fromEl.value.trim()) parts.push('from:' + fromEl.value.trim());
  if (toEl && toEl.value.trim()) parts.push('to:' + toEl.value.trim());
  if (atSearchEl && atSearchEl.value.trim()) {
    var atv = atSearchEl.value.trim();
    if (atv.indexOf('@') !== 0) atv = '@' + atv;
    parts.push(atv);
  }

  // account-type filters (タイプ指定)
  var onlyVerified = document.getElementById('only_verified');
  var excludeVerified = document.getElementById('exclude_verified');
  var onlyFollowing = document.getElementById('only_following');
  var excludeFollowing = document.getElementById('exclude_following');
  if (onlyVerified && onlyVerified.checked) parts.push('filter:verified');
  if (excludeVerified && excludeVerified.checked) parts.push('-filter:verified');
  if (onlyFollowing && onlyFollowing.checked) parts.push('filter:follows');
  if (excludeFollowing && excludeFollowing.checked) parts.push('-filter:follows');

  // engagement filters
  var onlyReplies = document.getElementById('only_replies');
  var onlyQuote = document.getElementById('only_quote');
  var excludeQuote = document.getElementById('exclude_quote');
  var excludeReplies = document.getElementById('exclude_replies');
  var onlyLinks = document.getElementById('only_links');
  var excludeLinks = document.getElementById('exclude_links');
  var onlyMedia = document.getElementById('only_media');
  var excludeMedia = document.getElementById('exclude_media');
  var onlyImages = document.getElementById('only_images');
  var excludeImages = document.getElementById('exclude_images');
  var onlyVideos = document.getElementById('only_videos');
  var excludeVideos = document.getElementById('exclude_videos');
  
  if (onlyReplies && onlyReplies.checked) parts.push('filter:replies');
  if (excludeReplies && excludeReplies.checked) parts.push('-filter:replies');
  if (onlyQuote && onlyQuote.checked) parts.push('filter:quote');
  if (excludeQuote && excludeQuote.checked) parts.push('-filter:quote');
  if (onlyLinks && onlyLinks.checked) parts.push('filter:links');
  if (excludeLinks && excludeLinks.checked) parts.push('-filter:links');
  if (onlyMedia && onlyMedia.checked) parts.push('filter:media');
  if (excludeMedia && excludeMedia.checked) parts.push('-filter:media');
  if (onlyImages && onlyImages.checked) parts.push('filter:images');
  if (excludeImages && excludeImages.checked) parts.push('-filter:images');
  if (onlyVideos && onlyVideos.checked) parts.push('filter:videos');
  if (excludeVideos && excludeVideos.checked) parts.push('-filter:videos');

  // numeric mins
  var minLikes = document.getElementById('q_min_likes');
  var minRetweets = document.getElementById('q_min_retweets');
  if (minLikes && isNumeric(minLikes.value)) parts.push('min_faves:' + minLikes.value);
  if (minRetweets && isNumeric(minRetweets.value)) parts.push('min_retweets:' + minRetweets.value);
  var minReplies = document.getElementById('q_min_replies');
  if (minReplies && isNumeric(minReplies.value)) parts.push('min_replies:' + minReplies.value);

  // lang
  var langSelect = document.getElementById('q_lang_select');
  if (langSelect && langSelect.value) parts.push('lang:' + langSelect.value);

  // dates
  var sinceDate = document.getElementById('q_since_date');
  var untilDate = document.getElementById('q_until_date');
  var since = (sinceDate && sinceDate.value) ? convertYYMMDDtoDate(sinceDate.value) : '';
  var until = (untilDate && untilDate.value) ? convertYYMMDDtoDate(untilDate.value) : '';
  if (since) parts.push('since:' + since);
  if (until) parts.push('until:' + until);

  // misc
  var miscEl = document.getElementById('q_misc');
  if (miscEl && miscEl.value) parts.push(miscEl.value.trim());

  // URL専用入力（url: を自動付与する）

  // URL専用入力（url: を自動付与する）
  var urlEl = document.getElementById('q_url');
  if (urlEl && urlEl.value && urlEl.value.trim()){
    var u = urlEl.value.trim();
    if (!/^url:/i.test(u)) u = 'url:' + u;
    parts.push(u);
  }

  return parts.filter(Boolean).join(' ').trim();
}

function buildSearchURL(query) {
  var encoded = encodeURIComponent(query || '');
  var base = 'https://x.com/search?q=' + encoded;
  var fParam = null;
  try {
    var mediaTab = document.getElementById('tab_media');
    var latestTab = document.getElementById('tab_latest');
    var topTab = document.getElementById('tab_top');
    if (mediaTab && mediaTab.getAttribute('aria-selected') === 'true') fParam = 'media';
    else if (latestTab && latestTab.getAttribute('aria-selected') === 'true') fParam = 'live';
    else if (topTab && topTab.getAttribute('aria-selected') === 'true') fParam = null;
    // override by explicit filters in query
    if (/filter:images/.test(query)) fParam = 'images';
    if (/filter:videos/.test(query)) fParam = 'videos';
    if (/filter:media/.test(query)) fParam = 'media';
  } catch (e) { /* ignore */ }
  if (fParam) base += '&f=' + encodeURIComponent(fParam);
  return base;
}

function updatePreview() {
  try {
    var q = buildQuery();
    var topQueryDisplay = document.getElementById('top_query_display');
    if (topQueryDisplay) {
      if (userEditedQuery && manualQueryOverride && manualQueryOverride.trim()) {
        topQueryDisplay.textContent = manualQueryOverride;
      } else {
        topQueryDisplay.textContent = q || '（検索クエリがここに表示されます）';
      }
    }
  } finally {
    scheduleSaveState();
  }
}

// schedule save state implementation
function collectState() {
  var state = { values: {} };
  document.querySelectorAll('input[id^="q_"], select[id^="q_"]').forEach(function(el){
    if (el.type === 'checkbox') state.values[el.id] = el.checked;
    else state.values[el.id] = el.value;
  });
  // save collapsed states
  Object.keys(DEFAULT_COLLAPSED_MAP).forEach(function(k){
    var el = document.getElementById(k);
    state[k] = !!(el && el.classList && el.classList.contains('collapsed'));
  });
  return state;
}

function restoreState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    var s = JSON.parse(raw);
    if (!s || !s.values) return;
    Object.keys(s.values).forEach(function(k){
      var el = document.getElementById(k);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!s.values[k];
      else el.value = s.values[k];
    });
    // restore collapsed
    Object.keys(DEFAULT_COLLAPSED_MAP).forEach(function(k){
      var collapsed = !!s[k];
      if (collapsed && COLLAPSIBLE_SETTERS[k]) COLLAPSIBLE_SETTERS[k](false);
      else if (!collapsed && COLLAPSIBLE_SETTERS[k]) COLLAPSIBLE_SETTERS[k](true);
    });
  } catch (e) {
    console.warn('restoreState failed', e);
  }
}

scheduleSaveState = debounce(function(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collectState())); }
  catch(e){ console.warn('save state failed', e); }
}, SAVE_DEBOUNCE_MS);

// bind inputs to preview
document.addEventListener('DOMContentLoaded', function(){
  document.querySelectorAll('input[id^="q_"], select[id^="q_"]').forEach(function(el){
    if (el.type === 'checkbox' || el.tagName.toLowerCase() === 'select') {
      el.addEventListener('change', function(){ userEditedQuery = false; manualQueryOverride = null; updatePreview(); });
    } else {
      el.addEventListener('input', function(){ userEditedQuery = false; manualQueryOverride = null; updatePreview(); });
    }
  });
  // also bind all checkboxes (including account/type checkboxes not starting with q_)
  document.querySelectorAll('input[type="checkbox"]').forEach(function(ch){ ch.addEventListener('change', function(){ userEditedQuery = false; manualQueryOverride = null; updatePreview(); }); });
  // initial restore and preview
  restoreState();
  syncTriToggleUI();
  updatePreview();
});

// bind result tabs (話題 / 最新 / メディア) to allow selection
document.addEventListener('DOMContentLoaded', function(){
  var tabs = document.querySelectorAll('#result_tabs .tab');
  if (!tabs || tabs.length === 0) return;
  tabs.forEach(function(tab){
    tab.addEventListener('click', function(){
      tabs.forEach(function(t){ t.setAttribute('aria-selected', 'false'); t.setAttribute('tabindex', '-1'); });
      tab.setAttribute('aria-selected', 'true'); tab.setAttribute('tabindex', '0');
      updatePreview();
    });
    tab.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tab.click(); } });
  });
});

// bind open-mode preference (auto/app/browser)
document.addEventListener('DOMContentLoaded', function(){
  var radios = document.querySelectorAll('input[name="open_mode"]');
  if (!radios || radios.length === 0) return;
  var saved = getStoredOpenMode();
  setOpenMode(saved, { skipSave: true });
  radios.forEach(function(r){
    r.addEventListener('change', function(){ if (r.checked) setOpenMode(r.value); });
  });
});

// Reset all inputs to defaults
function resetAllInputs() {
  // Reset inputs/selects/textareas that start with q_, and tri-toggle hidden checkboxes (only_/exclude_)
  var sel = 'input[id^="q_"], select[id^="q_"], textarea[id^="q_"], input[id^="only_"], input[id^="exclude_"]';
  document.querySelectorAll(sel).forEach(function(el){
    if (el.type === 'checkbox') el.checked = false;
    else el.value = '';
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(e){}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e){}
  });
  // clear phrase hidden list if present
  var ph = document.getElementById('q_phrase_list'); if (ph) ph.value = '[]';
  // clear any manual raw-query override when resetting inputs
  userEditedQuery = false;
  manualQueryOverride = null;
  updatePreview();
  scheduleSaveState();
}

// bind top reset and any btn_reset
document.addEventListener('DOMContentLoaded', function(){
  var topReset = document.getElementById('top_btn_reset');
  if (topReset) topReset.addEventListener('click', function(){ if (confirm('全ての入力をリセットしますか？')) resetAllInputs(); });
  var btnReset = document.getElementById('btn_reset');
  if (btnReset) btnReset.addEventListener('click', function(){ if (confirm('全ての入力をリセットしますか？')) resetAllInputs(); });
  var btnRestore = document.getElementById('btn_restore_query');
  if (btnRestore) {
    btnRestore.addEventListener('click', function(){ userEditedQuery = false; updatePreview(); try { document.getElementById('top_query_display').focus(); } catch(e){} });
  }
// --- セクション別モーダル開閉 ---
  });

// --- セクション別モーダル開閉 ---
document.addEventListener('DOMContentLoaded', function(){
  // data-modal を持つボタンでモーダルを開く（menu-btn / menu-actions 共通）
  document.querySelectorAll('[data-modal]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var modalId = btn.getAttribute('data-modal');
      var modal = document.getElementById(modalId);
      if (modal) modal.classList.add('active');
    });
  });
  
  // 閉じるボタンでモーダルを閉じる
  document.querySelectorAll('.section-modal-close[data-close]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var modalId = btn.getAttribute('data-close');
      var modal = document.getElementById(modalId);
      if (modal) modal.classList.remove('active');
    });
  });
  
  // モーダル外（オーバーレイ）クリックで閉じる
  document.querySelectorAll('.section-modal-overlay').forEach(function(overlay){
    overlay.addEventListener('click', function(e){
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });

  // クエリ補助機能は削除されました（UI内のプリセットを利用してください）

  // === 3択トグル（タイプ指定）===
  document.querySelectorAll('.tri-toggle').forEach(function(toggle) {
    var filter = toggle.dataset.filter;
    var buttons = toggle.querySelectorAll('button');
    
    buttons.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var val = btn.dataset.val;
        // すべてのボタンからactive-*クラスを削除
        buttons.forEach(function(b) {
          b.classList.remove('active-none', 'active-only', 'active-exclude');
        });
        // クリックされたボタンにクラス追加
        btn.classList.add('active-' + val);
        
        // hidden checkboxを更新
        var onlyEl = document.getElementById('only_' + filter);
        var excludeEl = document.getElementById('exclude_' + filter);
        
        if (val === 'only') {
          if (onlyEl) onlyEl.checked = true;
          if (excludeEl) excludeEl.checked = false;
        } else if (val === 'exclude') {
          if (onlyEl) onlyEl.checked = false;
          if (excludeEl) excludeEl.checked = true;
        } else {
          if (onlyEl) onlyEl.checked = false;
          if (excludeEl) excludeEl.checked = false;
        }
        
        if (typeof updatePreview === 'function') updatePreview();
      });
    });
  });

  // === タイプ指定モーダル 全リセットボタン ===
  var typeResetBtn = document.getElementById('btn_type_reset');
  if (typeResetBtn) {
    typeResetBtn.addEventListener('click', function() {
      // 全ての tri-toggle を「未指定」に戻す
      document.querySelectorAll('.tri-toggle').forEach(function(toggle) {
        var filter = toggle.dataset.filter;
        var buttons = toggle.querySelectorAll('button');
        buttons.forEach(function(btn) {
          btn.classList.remove('active-none', 'active-only', 'active-exclude');
          if (btn.dataset.val === 'none') btn.classList.add('active-none');
        });
        // hidden checkbox をリセット
        var onlyEl = document.getElementById('only_' + filter);
        var excludeEl = document.getElementById('exclude_' + filter);
        if (onlyEl) onlyEl.checked = false;
        if (excludeEl) excludeEl.checked = false;
      });
      // URL検索もリセット
      var urlEl = document.getElementById('q_url');
      if (urlEl) urlEl.value = '';
      if (typeof updatePreview === 'function') updatePreview();
    });
  }

  // === 期間クイック選択 ===
  document.querySelectorAll('.period-preset-btn[data-quick]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var quick = btn.dataset.quick;
      var sinceEl = document.getElementById('q_since_date');
      var untilEl = document.getElementById('q_until_date');
      var now = new Date();
      
      // すべてのプリセットボタンからactiveを外す
      document.querySelectorAll('.period-preset-btn').forEach(function(b) {
        b.classList.remove('active');
      });
      
      if (quick === 'clear') {
        if (sinceEl) sinceEl.value = '';
        if (untilEl) untilEl.value = '';
      } else {
        btn.classList.add('active');
        var days = parseInt(quick);
        var since = new Date(now);
        since.setDate(now.getDate() - days);
        
        var sinceStr = String(since.getFullYear()).slice(2) + String(since.getMonth() + 1).padStart(2, '0') + String(since.getDate()).padStart(2, '0');
        var untilDate = new Date(now);
        untilDate.setDate(now.getDate() + 1); // include today by advancing until (until is exclusive)
        var untilStr = String(untilDate.getFullYear()).slice(2) + String(untilDate.getMonth() + 1).padStart(2, '0') + String(untilDate.getDate()).padStart(2, '0');
        
        if (sinceEl) sinceEl.value = sinceStr;
        if (untilEl) untilEl.value = untilStr;
      }
      
      if (typeof updatePreview === 'function') updatePreview();
    });
  });

  // === カレンダー範囲（今日 / 今週 / 今月 / 今年） ===
  document.querySelectorAll('.period-preset-btn[data-range]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var range = btn.dataset.range;
      var now = new Date();
      var since = new Date(now);
      var until = new Date(now);

      if (range === 'today') {
        // since = today (no change)
      } else if (range === 'this_week') {
        // get Monday of this week (Monday = start)
        var dow = (now.getDay() + 6) % 7; // 0..6 where 0 is Monday
        since.setDate(now.getDate() - dow);
      } else if (range === 'this_month') {
        since = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (range === 'this_year') {
        since = new Date(now.getFullYear(), 0, 1);
      }

      function toYYMMDD(d){ return String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2,'0') + String(d.getDate()).padStart(2,'0'); }

      // advance until by one day so the selected range includes the intended end-date
      until.setDate(until.getDate() + 1);
      var sinceStr = toYYMMDD(since);
      var untilStr = toYYMMDD(until);
      var sinceEl = document.getElementById('q_since_date');
      var untilEl = document.getElementById('q_until_date');
      if (sinceEl) sinceEl.value = sinceStr;
      if (untilEl) untilEl.value = untilStr;

      // update active state for visual feedback
      document.querySelectorAll('.period-preset-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');

      if (typeof updatePreview === 'function') updatePreview();
    });
  });

  // === 開始日からn日（期間指定） ===
  document.querySelectorAll('.period-preset-btn[data-period-from]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var periodFrom = btn.dataset.periodFrom;
      var sinceInput = document.getElementById('q_since_date');
      var sinceVal = sinceInput ? sinceInput.value.trim() : '';
      if (!sinceVal || sinceVal.length !== 6) {
        alert('開始日を先に入力してください（yymmdd形式）');
        return;
      }
      var yy = parseInt('20' + sinceVal.slice(0, 2), 10);
      var mm = parseInt(sinceVal.slice(2, 4), 10) - 1;
      var dd = parseInt(sinceVal.slice(4, 6), 10);
      var since = new Date(yy, mm, dd);
      if (isNaN(since.getTime())) {
        alert('開始日が無効です');
        return;
      }
      var until = new Date(since);
      var days = parseInt(periodFrom);
      until.setDate(until.getDate() + days);
      // advance one more day so UI includes the intended end date (since until: is exclusive)
      until.setDate(until.getDate() + 1);

      var untilStr = String(until.getFullYear()).slice(2) + String(until.getMonth() + 1).padStart(2, '0') + String(until.getDate()).padStart(2, '0');
      var untilEl = document.getElementById('q_until_date');
      if (untilEl) untilEl.value = untilStr;
      if (typeof updatePreview === 'function') updatePreview();
    });
  });

  // 期間リセットボタン（カスタム期間のリセット）
  var periodResetBtn = document.getElementById('btn_period_reset');
  if (periodResetBtn) periodResetBtn.addEventListener('click', function() {
    var sinceEl = document.getElementById('q_since_date');
    var untilEl = document.getElementById('q_until_date');
    if (sinceEl) sinceEl.value = '';
    if (untilEl) untilEl.value = '';
    // clear active state on presets
    document.querySelectorAll('.period-preset-btn').forEach(function(b) { b.classList.remove('active'); });
    if (typeof updatePreview === 'function') updatePreview();
  });

  // テーマ選択は削除されました

  // rei image lightbox handlers (separate DOMContentLoaded to ensure elements exist)
  document.addEventListener('DOMContentLoaded', function() {
    var rei = document.getElementById('rei_img');
    var overlay = document.getElementById('rei_overlay');
    var overlayImg = document.getElementById('rei_overlay_img');
    var closeBtn = document.getElementById('close_rei_overlay');
    if (rei && overlay && overlayImg) {
      rei.addEventListener('click', function() {
        overlay.style.display = 'flex';
        overlay.classList.add('active');
        overlayImg.src = rei.src;
      });
      if (closeBtn) closeBtn.addEventListener('click', function(e) { e.stopPropagation(); overlay.style.display = 'none'; overlay.classList.remove('active'); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) { overlay.style.display = 'none'; overlay.classList.remove('active'); } });
    }
  });

  // iOS Safari キーボード表示時のページズレ対策
  if (window.visualViewport) {
    var initialHeight = window.visualViewport.height;
    var lastScrollTop = 0;
    
    function handleViewportChange() {
      var currentHeight = window.visualViewport.height;
      var offsetTop = window.visualViewport.offsetTop;
      
      // キーボードが表示された（ビューポートが縮小された）場合
      if (currentHeight < initialHeight * 0.85) {
        // ページのスクロールを元に戻す
        window.scrollTo(0, 0);
        document.body.style.position = 'fixed';
        document.body.style.top = '0';
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.bottom = 'auto';
      } else {
        // キーボードが非表示になった場合
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.bottom = '';
        window.scrollTo(0, 0);
      }
    }
    
    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', function() {
      // ビューポートのスクロールを防ぐ
      window.scrollTo(0, 0);
    });
  }

  // フォーカス時のスクロール防止（iOS Safari用）
  var inputFields = document.querySelectorAll('input[type="text"], textarea, select');
  inputFields.forEach(function(field) {
    field.addEventListener('focus', function(e) {
      setTimeout(function() {
        window.scrollTo(0, 0);
      }, 100);
    });
  });

  // モーダル内の入力フィールドがキーボードで隠れないようにする
  var modalInputs = document.querySelectorAll('.section-modal input[type="text"], .section-modal textarea');
  modalInputs.forEach(function(input) {
    input.addEventListener('focus', function(e) {
      var modal = input.closest('.section-modal');
      if (modal) {
        setTimeout(function() {
          // 入力フィールドがモーダル内で見えるようにスクロール
          input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    });
  });

});