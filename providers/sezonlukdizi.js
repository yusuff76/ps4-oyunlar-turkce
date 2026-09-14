// SezonlukDizi provider. Original port: @keyiflerolsun / nuvio: Wekmed.
// Promise chains keep this file compatible with Nuvio's dynamic JS runtime.
var DEFAULT_BASE = 'https://sezonlukdizi.cc';
// Only needed on older clients that do not expose provider settings.
var TMDB_API_KEY = "03e8d7066b5e31249aa673d03b4593ae";
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

function onSettings() {
  return Promise.resolve([
    { type: 'text', key: 'tmdbApiKey', label: 'TMDB API Key (v3)', placeholder: 'Kendi TMDB API anahtarınız' },
    { type: 'text', key: 'baseUrl', label: 'SezonlukDizi adresi', defaultValue: DEFAULT_BASE, placeholder: DEFAULT_BASE }
  ]);
}

function slugify(value) {
  return String(value || '').replace(/İ/g, 'I').toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function matchTitle(value) {
  return slugify(String(value || '').replace(/\s*\(\d{4}\)\s*$/, ''))
    .split('-').filter(function(word) { return word !== 'the'; }).join('-');
}

function absoluteUrl(value, base) {
  value = String(value || '').replace(/&amp;/g, '&').replace(/&#38;/g, '&');
  if (/^https?:\/\//i.test(value)) return value;
  if (value.indexOf('//') === 0) return 'https:' + value;
  if (value.charAt(0) === '/') return base + value;
  return '';
}

function logError(stage, error) {
  // Do not log URLs: TMDB query strings contain the user's API key.
  if (typeof console !== 'undefined' && console.warn) console.warn('[SezonlukDizi] ' + stage + ': ' + (error.code || 'istek/ayrıştırma hatası'));
}

function failure(code) { var error = new Error(code); error.code = code; return error; }

function getStreams(tmdbId, mediaType, season, episode) {
  // Desktop/Cinemeta can pass an IMDb ID when the app's own TMDB lookup fails.
  // Resolve it with this provider's key instead of silently returning no streams.
  if (mediaType !== 'tv' && mediaType !== 'series') return Promise.resolve([]);
  var contentId = String(tmdbId || '').trim().replace(/^tmdb[:/]/i, '');
  var episodeId = contentId.match(/^([^:]+):(\d+):(\d+)$/);
  if (episodeId) {
    contentId = episodeId[1];
    if (season == null) season = episodeId[2];
    if (episode == null) episode = episodeId[3];
  }
  if (!/^(?:\d+|tt\d+)$/.test(contentId) || !/^\d+$/.test(String(season)) || !/^[1-9]\d*$/.test(String(episode))) return Promise.resolve([]);
  var settings = typeof globalThis !== 'undefined' ? (globalThis.SCRAPER_SETTINGS || {}) : {};
  var apiKey = String(settings.tmdbApiKey || TMDB_API_KEY).trim();
  var base = String(settings.baseUrl || DEFAULT_BASE).trim().replace(/\/+$/, '');
  if (!apiKey) { logError('TMDB', failure('Eklenti ayarlarından TMDB API Key girin')); return Promise.resolve([]); }
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(base)) return Promise.resolve([]);
  // Each invocation owns its cookie jar; parallel episode requests cannot overwrite it.
  var cookies = {};
  function request(url, options) {
    options = options || {};
    var local = url.indexOf(base + '/') === 0;
    var headers = Object.assign({ 'User-Agent': UA }, options.headers || {});
    if (local) {
      headers.Referer = headers.Referer || base + '/';
      var cookie = Object.keys(cookies).map(function(key) { return key + '=' + cookies[key]; }).join('; ');
      if (cookie) headers.Cookie = cookie;
    }
    return fetch(url, Object.assign({}, options, { headers: headers })).then(function(response) {
      if (response.status >= 400) throw failure('HTTP ' + response.status);
      if (local && response.headers && response.headers.get) {
        var raw = response.headers.get('set-cookie') || '';
        // An Expires attribute contains a comma; split only at the next cookie name.
        raw.split(/,(?=\s*[^;,=\s]+=)/).forEach(function(part) {
          var pair = part.trim().split(';')[0], equal = pair.indexOf('=');
          if (equal > 0) cookies[pair.slice(0, equal)] = pair.slice(equal + 1);
        });
      }
      return response.text();
    });
  }
  function post(path, body, referer) {
    return request(base + path, { method: 'POST', body: body, headers: {
      'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': base, 'Referer': referer || base + '/'
    } });
  }
  function validateSlug(slug) {
    if (!slug) return Promise.resolve(null);
    return request(base + '/diziler/' + slug + '.html').then(function(html) {
      if (/Sayfa Bulunamad|Haydaaa/i.test(html)) return null;
      // Require a real show navigation link, rather than accepting any HTTP 200 page.
      var link = html.match(/href=["']\/(?:bolumler|diziler)\/([^/"']+)\.html["']/i);
      return link && link[1] === slug ? slug : null;
    }).catch(function() { return null; });
  }
  function findSlug(info) {
    var candidates = [slugify(info.original_name), slugify(info.name)].filter(function(s, i, a) { return s && a.indexOf(s) === i; });
    function direct(index) {
      if (index >= candidates.length) return Promise.resolve(null);
      return validateSlug(candidates[index]).then(function(found) { return found || direct(index + 1); });
    }
    function search(query) {
      return post('/ajax/arama.asp', 'q=' + encodeURIComponent(query)).then(function(text) {
        var data = JSON.parse(text);
        var shows = data.results && data.results.diziler && data.results.diziler.results || [];
        var matches = shows.filter(function(show) {
          var sameName = [show.title, show.description].some(function(title) {
            return [info.original_name, info.name].some(function(name) { return name && matchTitle(name) === matchTitle(title); });
          });
          var year = (show.title || '').match(/\((\d{4})\)\s*$/);
          return sameName && (!year || !info.first_air_date || year[1] === info.first_air_date.slice(0, 4));
        });
        if (matches.length !== 1) return null;
        var match = String(matches[0].url || '').match(/^\/diziler\/([^/]+)\.html$/);
        return match ? match[1] : null;
      }).catch(function() { return null; });
    }
    return direct(0).then(function(found) {
      if (found) return found;
      var title = info.original_name || info.name;
      return search(title).then(function(result) {
        // A shorter search finds titles with an extra word, e.g. "The Lost Tapes".
        return result || search(title.split(/\s+/).slice(0, 2).join(' '));
      });
    });
  }
  function extract(source, label, endpoints, epUrl) {
    var name = String(source.baslik || '').toLowerCase();
    if (name !== 'sibnet' && name !== 'vidmoly') return Promise.resolve(null);
    return post(endpoints.embed, 'id=' + encodeURIComponent(source.id), epUrl).then(function(html) {
      var frame = html.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
      var src = frame && absoluteUrl(frame[1], base);
      if (!src) return null;
      return request(src, { headers: { Referer: epUrl } }).then(function(player) {
        var media;
        if (name === 'sibnet') {
          media = player.match(/(?:src|file)\s*:\s*["']((?:https?:\/\/[^/"']+)?\/v\/[^"']+\.mp4[^"']*)["']/i);
        } else {
          player = player.replace(/\\\//g, '/');
          media = player.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
        }
        if (!media) return null;
        var url = absoluteUrl(media[1], 'https://video.sibnet.ru');
        return { name: 'SezonlukDizi', title: (name === 'sibnet' ? 'Sibnet' : 'VidMoly') + ' | ' + label,
          url: url, type: name === 'sibnet' ? 'direct' : 'hls',
          headers: { 'User-Agent': UA, Referer: src } };
      });
    }).catch(function(error) { logError(name, error); return null; });
  }
  function tmdbInfo() {
    var resolvedId = /^tt\d+$/.test(contentId)
      ? request('https://api.themoviedb.org/3/find/' + contentId + '?api_key=' + encodeURIComponent(apiKey) + '&external_source=imdb_id').then(function(text) {
          var found = JSON.parse(text);
          var shows = found.tv_results || [];
          if (shows.length !== 1 || !shows[0].id) throw failure('IMDb dizi kimliği TMDB ile eşleştirilemedi');
          return String(shows[0].id);
        })
      : Promise.resolve(contentId);
    return resolvedId.then(function(id) {
      return request('https://api.themoviedb.org/3/tv/' + id + '?api_key=' + encodeURIComponent(apiKey) + '&language=tr-TR');
    }).then(function(text) {
      var info = JSON.parse(text);
      if (!info.name && !info.original_name) throw failure('TMDB dizi bilgisi alınamadı');
      return info;
    });
  }
  return Promise.all([
    tmdbInfo(),
    request(base + '/js/site.min.js').then(function(js) {
      var alt = js.match(/\/ajax\/dataAlternatif[^\s"']*?\.asp/);
      var embed = js.match(/\/ajax\/dataEmbed[^\s"']*?\.asp/);
      if (!alt || !embed) throw failure('AJAX uçları bulunamadı');
      return { alternatives: alt[0], embed: embed[0] };
    })
  ]).then(function(init) {
    var info = init[0], endpoints = init[1];
    return findSlug(info).then(function(slug) {
      if (!slug) throw failure('Dizi adı eşleştirilemedi');
      var epUrl = base + '/' + slug + '/' + season + '-sezon-' + episode + '-bolum.html';
      return request(epUrl).then(function(html) {
        var element = html.match(/<[^>]+\bid\s*=\s*["']dilsec["'][^>]*>/i);
        var id = element && element[0].match(/\bdata-id\s*=\s*["'](\d+)["']/i);
        if (!id) throw failure('Bölüm kimliği bulunamadı');
        return Promise.all(['0', '1'].map(function(language) {
          return post(endpoints.alternatives, 'bid=' + id[1] + '&dil=' + language, epUrl).then(function(text) {
            var data = JSON.parse(text);
            var list = Array.isArray(data) ? data : data.status === 'success' && Array.isArray(data.data) ? data.data : [];
            return Promise.all(list.map(function(source) {
              return extract(source, language === '0' ? 'TR Dublaj' : 'TR Altyazı', endpoints, epUrl);
            }));
          }).catch(function(error) { logError('Kaynak listesi', error); return []; });
        })).then(function(lists) {
          return lists[0].concat(lists[1]).filter(Boolean).map(function(stream) {
            stream.title = (info.name || info.original_name) + ' | ' + stream.title;
            return stream;
          });
        });
      });
    });
  }).catch(function(error) { logError('Kaynak arama', error); return []; });
}

module.exports = { getStreams: getStreams, onSettings: onSettings };
