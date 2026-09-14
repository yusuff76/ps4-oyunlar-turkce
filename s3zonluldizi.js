/**
 * SezonlukDizi / Nuvio — 2026-09-14
 * Eski sağlayıcı dosyasının tamamının yerine kullanın.
 * Desteklenen çözücüler: Sibnet, VidMoly ve doğrudan MP4/HLS.
 * name: TMDB dizi adı; title: kaynak ve dil.
 * DEBUG açıkken hatalar [SEZONLUKDIZI] önekiyle konsola yazılır.
 * Nuvio içinde oynatma ayrıca test edilmelidir.
 */
var BASE_URL = 'https://sezonlukdizi.cc';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';
var DEBUG = true;
var TIMEOUT_MS = 18000;
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

function log(message) {
  if (DEBUG && typeof console !== 'undefined' && console.log) console.log('[SEZONLUKDIZI] ' + message);
}
function decodeHtml(s) {
  return String(s || '').replace(/&amp;/gi, '&').replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}
function absolute(s, base) {
  s = decodeHtml(s).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.indexOf('//') === 0) return 'https:' + s;
  if (typeof URL !== 'undefined') {
    try { return new URL(s, base).href; } catch (e) {}
  }
  var origin = (base.match(/^https?:\/\/[^/]+/i) || [])[0];
  return origin ? (s.charAt(0) === '/' ? origin + s : base.replace(/[^/]*$/, '') + s) : '';
}
function sameSite(url) { return url === BASE_URL || url.indexOf(BASE_URL + '/') === 0; }
function attribute(tag, name) {
  var m = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(["\x27])([^"\x27]*)\\1', 'i'));
  return m ? decodeHtml(m[2]) : '';
}
function rememberCookies(headers, session) {
  if (!headers || typeof headers.get !== 'function') return;
  var list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  if (!list.length) list = (headers.get('set-cookie') || '').split(/,(?=\s*[^\s;,=]+\s*=)/);
  list.forEach(function(line) {
    var pair = line.split(';')[0].trim(), p = pair.indexOf('=');
    if (p > 0) session.cookies[pair.slice(0, p)] = pair.slice(p + 1);
  });
}
function request(url, options, session, stage) {
  options = options || {};
  var headers = Object.assign({ 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8' }, options.headers || {});
  if (session && sameSite(url)) {
    var cookie = Object.keys(session.cookies).map(function(k) { return k + '=' + session.cookies[k]; }).join('; ');
    if (cookie) headers.Cookie = cookie;
  }
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var config = Object.assign({}, options, { headers: headers });
  if (controller) config.signal = controller.signal;
  return new Promise(function(resolve, reject) {
    var finished = false;
    var timer = setTimeout(function() {
      finished = true;
      if (controller) controller.abort();
      reject(new Error(stage + ': zaman aşımı'));
    }, TIMEOUT_MS);
    Promise.resolve().then(function() { return fetch(url, config); }).then(function(r) {
      if (r.status >= 400) throw new Error(stage + ': HTTP ' + r.status);
      if (session && sameSite(url) && (!r.url || sameSite(r.url))) rememberCookies(r.headers, session);
      return r.text();
    }).then(function(body) {
      if (finished) return;
      finished = true; clearTimeout(timer); resolve(body);
    }, function(e) {
      if (finished) return;
      finished = true; clearTimeout(timer); reject(new Error(stage + ': ' + e.message));
    });
  });
}
function post(url, data, session, referer, stage) {
  var body = Object.keys(data).map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(data[k]); }).join('&');
  return request(url, { method: 'POST', body: body, headers: {
    'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest',
    'Origin': BASE_URL, 'Referer': referer
  } }, session, stage);
}
function titleToSlug(t) {
  return String(t || '').replace(/İ/g, 'i').toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function fetchTmdbInfo(id) {
  return request('https://api.themoviedb.org/3/tv/' + encodeURIComponent(id) + '?api_key=' + TMDB_API_KEY + '&language=tr-TR', {}, null, 'TMDB')
    .then(function(text) {
      var d = JSON.parse(text);
      if (!d.name && !d.original_name) throw new Error('TMDB: dizi adı alınamadı');
      return { title: d.name || d.original_name, titleEn: d.original_name || '', titleTr: d.name || '' };
    });
}
function fetchAspData(session) {
  return request(BASE_URL + '/', { headers: { Referer: BASE_URL + '/' } }, session, 'Anasayfa').then(function(home) {
    var tags = home.match(/<script\b[^>]*>/gi) || [], script = '';
    tags.some(function(tag) {
      var src = attribute(tag, 'src');
      if (/\/site(?:\.min)?\.js(?:\?|$)/i.test(src)) { script = absolute(src, BASE_URL + '/'); return true; }
      return false;
    });
    if (!script) script = BASE_URL + '/js/site.min.js';
    return request(script, { headers: { Referer: BASE_URL + '/' } }, session, 'Site JavaScript');
  }).then(function(js) {
    var alt = js.match(/dataAlternatif[\w-]*\.asp/i), embed = js.match(/dataEmbed[\w-]*\.asp/i);
    if (!alt || !embed) throw new Error('AJAX adresleri bulunamadı; site yapısı veya gelen yanıt değişmiş olabilir');
    log('AJAX: ' + alt[0] + ', ' + embed[0]);
    return { alternatif: BASE_URL + '/ajax/' + alt[0], embed: BASE_URL + '/ajax/' + embed[0] };
  });
}
function findShowSlug(info, session) {
  var candidates = [titleToSlug(info.titleEn), titleToSlug(info.titleTr)].filter(function(s, i, a) { return s && a.indexOf(s) === i; });
  function next(i) {
    if (i >= candidates.length) throw new Error('Dizi eşleşmedi: ' + info.title + '; sitedeki dizi adresini kontrol edin');
    var slug = candidates[i];
    return request(BASE_URL + '/diziler/' + slug + '.html', {}, session, 'Dizi sayfası').then(function(html) {
      var tags = html.match(/<a\b[^>]*>/gi) || [], found = '';
      tags.some(function(tag) {
        var href = absolute(attribute(tag, 'href'), BASE_URL + '/');
        if (!sameSite(href)) return false;
        var m = href.slice(BASE_URL.length).match(/^\/([^/]+)\/\d+-sezon-\d+-bolum\.html(?:[?#]|$)/i);
        if (m) { found = m[1]; return true; }
        return false;
      });
      if (!found) throw new Error('Geçerli bölüm bağlantısı yok: ' + slug);
      return found;
    }).catch(function(e) { log(e.message); return next(i + 1); });
  }
  return Promise.resolve().then(function() { return next(0); });
}
function fetchBid(url, session) {
  return request(url, { headers: { Referer: BASE_URL + '/' } }, session, 'Bölüm sayfası').then(function(html) {
    var tags = html.match(/<[a-z][^>]*>/gi) || [], bid = '';
    tags.some(function(tag) {
      if (attribute(tag, 'id') === 'dilsec') { bid = attribute(tag, 'data-id'); return !!bid; }
      return false;
    });
    if (!/^\d+$/.test(bid)) throw new Error('Bölüm kimliği bulunamadı (#dilsec data-id)');
    log('Bölüm kimliği: ' + bid);
    return bid;
  });
}
function alternatives(bid, lang, asp, session, referer) {
  return post(asp.alternatif, { bid: bid, dil: lang }, session, referer, 'Alternatifler/' + lang).then(function(text) {
    var j;
    try { j = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { throw new Error('Alternatifler/' + lang + ': JSON yerine farklı yanıt geldi'); }
    if (Array.isArray(j)) return j;
    if (j.status === 'success' && Array.isArray(j.data)) return j.data;
    throw new Error('Alternatifler/' + lang + ': beklenen liste alınamadı');
  }).catch(function(e) { log(e.message); return []; });
}
function iframeUrl(html, base) {
  var tags = html.match(/<iframe\b[^>]*>/gi) || [];
  for (var i = 0; i < tags.length; i++) {
    var src = attribute(tags[i], 'src') || attribute(tags[i], 'data-src');
    if (src) return absolute(src, base);
  }
  return '';
}
function mediaUrl(html, base, extension) {
  var clean = decodeHtml(html).replace(/\\\//g, '/').replace(/\\u0026/gi, '&');
  var re = new RegExp('["\x27]((?:https?:)?//[^"\x27\\s<>]+\\.' + extension + '(?:[?#][^"\x27\\s<>]*)?)["\x27]', 'i');
  var m = clean.match(re);
  if (m) return absolute(m[1], base);
  re = new RegExp('(?:src|file)\\s*:\\s*["\x27]([^"\x27]+\\.' + extension + '(?:[?#][^"\x27]*)?)["\x27]', 'i');
  m = clean.match(re);
  return m ? absolute(m[1], base) : '';
}
function processVeri(item, dil, asp, session, referer) {
  var label = String(item.baslik || 'Video');
  // Bu sağlayıcılar için çözücü yok; iframe adresini video olarak döndürmeyin.
  if (/^(pixel|netu|dzen|okru|filemoon)$/i.test(label)) { log('Desteklenmeyen kaynak: ' + label); return Promise.resolve(null); }
  return post(asp.embed, { id: item.id }, session, referer, 'Embed/' + label).then(function(html) {
    var src = iframeUrl(html, referer);
    if (!src) {
      var direct = mediaUrl(html, referer, 'm3u8') || mediaUrl(html, referer, 'mp4');
      if (direct) return { provider: label, dil: dil, url: direct, type: /\.m3u8(?:[?#]|$)/i.test(direct) ? 'hls' : 'direct', headers: { Referer: referer, 'User-Agent': UA } };
      throw new Error('Iframe veya doğrudan video bulunamadı');
    }
    var host = ((src.match(/^https?:\/\/([^/:]+)/i) || [])[1] || '').toLowerCase();
    var provider, page = src;
    if (/(^|\.)sibnet\.ru$/.test(host)) {
      provider = 'Sibnet';
      var id = (src.match(/[?&]videoid=(\d+)/i) || src.match(/video(\d+)/i) || [])[1];
      if (!id) throw new Error('Sibnet video kimliği yok');
      page = 'https://video.sibnet.ru/shell.php?videoid=' + id;
    } else if (/(^|\.)vidmoly\.[a-z.]+$/.test(host)) provider = 'VidMoly';
    else { log('Çözücü yok: ' + label + ' (' + host + ')'); return null; }
    return request(page, { headers: { Referer: referer } }, null, provider).then(function(player) {
      var stream = mediaUrl(player, page, 'm3u8') || mediaUrl(player, page, 'mp4');
      if (!stream) throw new Error(provider + ': oynatılabilir bağlantı bulunamadı');
      return { provider: provider, dil: dil, url: stream, type: /\.m3u8(?:[?#]|$)/i.test(stream) ? 'hls' : 'direct', headers: { Referer: page, 'User-Agent': UA } };
    });
  }).catch(function(e) { log(label + ': ' + e.message); return null; });
}
function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== 'tv') return Promise.resolve([]);
  if (!/^\d+$/.test(String(tmdbId)) || !/^\d+$/.test(String(season)) || !/^[1-9]\d*$/.test(String(episode))) {
    log('Geçersiz TMDB/sezon/bölüm bilgisi'); return Promise.resolve([]);
  }
  var session = { cookies: {} };
  return Promise.all([fetchTmdbInfo(tmdbId), fetchAspData(session)]).then(function(init) {
    var info = init[0], asp = init[1];
    return findShowSlug(info, session).then(function(slug) {
      var epUrl = BASE_URL + '/' + slug + '/' + Number(season) + '-sezon-' + Number(episode) + '-bolum.html';
      return fetchBid(epUrl, session).then(function(bid) {
        return Promise.all([alternatives(bid, '0', asp, session, epUrl), alternatives(bid, '1', asp, session, epUrl)]);
      }).then(function(lists) {
        log('Kaynak sayısı: dublaj=' + lists[0].length + ', altyazı=' + lists[1].length);
        var jobs = [];
        lists.forEach(function(list, index) {
          list.forEach(function(item) { jobs.push(processVeri(item, index === 0 ? '🇹🇷 TR Dublaj' : '🌐 TR Altyazı', asp, session, epUrl)); });
        });
        return Promise.all(jobs).then(function(results) {
          var seen = {};
          var streams = results.filter(function(s) {
            if (!s) return false;
            var key = s.dil + '|' + s.url;
            if (seen[key]) return false;
            seen[key] = true; return true;
          }).map(function(s) {
            return { name: info.title, title: '⌜ SEZONLUKDIZI ⌟ | ' + s.provider + ' | ' + s.dil, url: s.url, type: s.type, headers: s.headers };
          });
          log('Bulunan oynatılabilir kaynak: ' + streams.length);
          return streams;
        });
      });
    });
  }).catch(function(e) { log(e.message); return []; });
}
module.exports = { getStreams: getStreams };
