'use strict'
/*
 * 音源猎手 (LX Source Hunter) — Songloft JS 插件
 * 功能：GitHub 音源爬取 → 去重入库 → 可达性检测 → jsenv 沙箱深度检测（真实取链+音频校验）
 *      → 一键导入洛雪音源插件（调用 lxmusic 网关 /api/sources/import-url）
 *
 * 宿主契约（与 lxmusic.jsplugin 相同）：
 *   globalThis.onInit / onDeinit / onHTTPRequest
 *   songloft.storage.get/set/delete, songloft.log.*, songloft.jsenv.*,
 *   songloft.plugin.getHostUrl()/getToken(), 全局 fetch
 */

// ==================== 常量 ====================
var CFG_KEY = 'hunter_config'
var DB_KEY = 'hunter_db'
var IMPORTED_KEY = 'hunter_imported' // 灌入 lxmusic 的记录（entryId -> lx 信息）

var DEFAULT_REPOS = [
  'guoyue2010/lxmusic-',
  'ZxwyWebSite/lx-script',
  'ZxwyWebSite/lx-source',
  'laosunmaker/New_lxmusic_source',
  'cc2415/lx-custom-music-source',
  'ycquah00/lx-music-source-v5',
  'javon4016/xgzy-mysources',
  'pronii/lx-music-qdy-mini',
  'yanghook730-sketch/lx-music-source-yuanli',
  'fengyvle/yyt-music-sources',
  'peakshuoera/lx-music-source-manager',
  'wwnbalone/lx-manager',
  // ---- 2026-09-19 从 lxhub.lllh.de 收录数据提取补充（origin_repo 去重后 18 个）----
  'NeoDtime/lxmusic-source3',
  'sphenoid-111/LXmusicyy',
  'lczj1215/lx-music',
  'a97083435/lxmusic-source',
  'LXJ-George666/LXMusic-Yinyuan',
  'LuoXiaohei-2025/LX-music-collection',
  'Macrohard0001/lx-ikun-music-sources',
  'lxmusics/lx-music-api-server-python',
  'hejuworld-droid/lx-music-source',
  'haonanren118/jiexiang-Music-Source',
  'hllsg/lx-music-myvip',
  'ZhonX07/lx-music-source-netease',
  'Scotlight/lx-music-source-gateway',
  'HJinTao/Listening',
  'mlik-git/lx-music',
  '7878gyc/gdstudio-lx-source',
  'piko017/-LX-luoxue_yinyuan',
  'wzh15802/lxmusic'
]

var TEST_SONGS = {
  wy: [{ name: '海阔天空', info: { songmid: '347230' } }],
  tx: [{ name: '晴天', info: { songmid: '0039MnYb0qxYhV' } }],
  kw: [{ name: '晴天', info: { songmid: '838607' } }],
  kg: [{ name: '晴天', info: { hash: '30ece05c17d4e9ec8ba0ef9f96e7a07c' } }],
  mg: [{ name: '晴天', info: { copyrightId: '69984639', songmid: '69984639' } }]
}
var PLATFORMS = ['wy', 'tx', 'kw', 'kg', 'mg']

var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
var MAX_CONTENT_BYTES = 2 * 1024 * 1024
var GH_HEADERS = { 'User-Agent': 'lx-hunter-plugin/1.0', 'Accept': 'application/vnd.github+json' }
// 带 Token 的 GitHub API 请求头（Token 可选：未认证限额 60 次/小时，认证后 5000 次/小时）
function ghHeaders() {
  var h = {}
  for (var k in GH_HEADERS) h[k] = GH_HEADERS[k]
  if (config && config.ghToken) h['Authorization'] = 'Bearer ' + config.ghToken
  return h
}

// jsenv 内的洛雪宿主 polyfill（与 lxmusic.jsplugin 的 bootstrap 一致）
var BOOTSTRAP = [
  "'use strict';",
  'var _eventHandlers = new Map();',
  'var _registeredSources = {};',
  'globalThis.lx = {',
  "  version: '2.0.0', env: 'desktop', platform: 'web',",
  '  currentScriptInfo: { name: "", description: "", version: "", author: "", homepage: "", rawScript: "" },',
  '  EVENT_NAMES: { request: "request", inited: "inited", updateAlert: "updateAlert" },',
  '  utils: {',
  '    buffer: {',
  '      from: function(d, e) { return Buffer.from(d, e); },',
  '      bufToString: function(b, f) { return (b !== null && typeof b === "object" && typeof b.toString === "function") ? b.toString(f || "utf8") : Buffer.from(b, "binary").toString(f || "utf8"); }',
  '    },',
  '    crypto: {',
  "      md5: function(s) { return crypto.md5(s || ''); },",
  '      aesEncrypt: function(b, m, k, iv) { return crypto.aesEncrypt(b, m, k, iv); },',
  '      rsaEncrypt: function(b, k) { return crypto.rsaEncrypt(b, k); },',
  '      randomBytes: function(n) { return crypto.randomBytes(n); }',
  '    },',
  '    zlib: {',
  '      inflate: function(b) { return zlib.inflate(b); },',
  '      deflate: function(b) { return zlib.deflate(b); }',
  '    }',
  '  },',
  '  request: function(url, options, callback) {',
  '    if (typeof options === "function") { callback = options; options = {}; }',
  '    options = options || {};',
  '    var method = (options.method || "GET").toUpperCase();',
  '    var headers = options.headers || {};',
  '    var bodyContent = options.body || null;',
  '    if (options.form) {',
  '      bodyContent = options.form;',
  '      if (typeof bodyContent === "object") {',
  '        var parts = [];',
  '        for (var k in bodyContent) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(bodyContent[k]));',
  '        bodyContent = parts.join("&");',
  '        if (!headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";',
  '      }',
  '    }',
  '    if (bodyContent !== null && typeof bodyContent === "object") {',
  '      bodyContent = JSON.stringify(bodyContent);',
  '      if (!headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json";',
  '    }',
  '    var aborted = false, called = false;',
  '    function safe(err, resp, body) {',
  '      if (aborted || called) return; called = true;',
  '      if (typeof callback === "function") { try { callback(err, resp, body); } catch (e) {} }',
  '    }',
  '    fetch(url, { method: method, headers: headers, body: bodyContent }).then(function(resp) {',
  '      if (aborted) return;',
  '      return resp.text().then(function(text) {',
  '        if (aborted) return;',
  '        var body = text; try { body = JSON.parse(text); } catch (_) {}',
  '        safe(null, { statusCode: resp.status, statusMessage: resp.statusText || "", headers: resp.headers || {}, body: body }, body);',
  '      });',
  '    }).catch(function(err) {',
  '      if (aborted) return;',
  '      safe(new Error((err && err.message) ? err.message : String(err)), null, null);',
  '    });',
  '    return function() { aborted = true; };',
  '  },',
  '  send: function(eventName, data) {',
  '    if (eventName === "inited" && data && data.sources) _registeredSources = data.sources;',
  '    if (typeof __go_send === "function") { try { __go_send(eventName, JSON.stringify(data)); } catch (e) {} }',
  '  },',
  '  on: function(eventName, handler) { _eventHandlers.set(eventName, handler); },',
  '  _dispatch: function(requestId, eventName, data) {',
  '    var handler = _eventHandlers.get(eventName);',
  '    if (typeof handler !== "function") {',
  '      if (typeof __go_send === "function") __go_send("dispatchError", JSON.stringify({ id: requestId, error: "No handler registered for event: " + eventName }));',
  '      return;',
  '    }',
  '    var settled = false;',
  '    function sendResult(v) { if (settled) return; settled = true; if (typeof __go_send === "function") __go_send("dispatchResult", JSON.stringify({ id: requestId, result: v })); }',
  '    function sendError(e) { if (settled) return; settled = true; if (typeof __go_send === "function") __go_send("dispatchError", JSON.stringify({ id: requestId, error: (e && e.message) ? e.message : String(e) })); }',
  '    try {',
  '      var result = handler(data);',
  '      if (result && typeof result.then === "function") {',
  '        var t = setTimeout(function() { sendError(new Error("dispatch timeout")); }, 18000);',
  '        result.then(function(v) { clearTimeout(t); sendResult(v); }, function(e) { clearTimeout(t); sendError(e); });',
  '      } else sendResult(result);',
  '    } catch (err) { sendError(err); }',
  '  },',
  '  _getSources: function() { return _registeredSources; }',
  '};',
  'globalThis.window = globalThis;',
  'globalThis.global = globalThis;'
].join('\n')

// ==================== 状态 ====================
var config = null
var db = { sources: {}, lastCrawl: 0 }
var imported = {} // entryId -> { lxId, name, importedAt }
var job = { running: false, type: '', cancelRequested: false, progress: {} }
var logBuf = []
var logSeq = 0

function log(msg, module, level) {
  logSeq++
  logBuf.push({ seq: logSeq, ts: Date.now(), level: level || 'info', module: module || '系统', msg: String(msg) })
  if (logBuf.length > 800) logBuf.shift()
  var fn = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'
  try { songloft.log[fn]('[' + (module || '系统') + '] ' + msg) } catch (e) {}
}

function saveDbSoon() { // 简单去抖由调用方控制，这里直接存
  return songloft.storage.set(DB_KEY, JSON.stringify(db))
}

// ==================== 工具 ====================
function jsonResp(obj, status) {
  return { statusCode: status || 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }
}
function errResp(status, msg) { return jsonResp({ error: msg }, status) }

function parseQuery(qs) {
  var out = {}
  if (!qs) return out
  // 兼容三种宿主传参形态：查询字符串 / 已解析对象 / URLSearchParams
  if (typeof qs === 'string') {
    var parts = String(qs).split('&')
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i]
      var eq = p.indexOf('=')
      if (eq === -1) { try { out[decodeURIComponent(p)] = '' } catch (e) {} continue }
      try {
        out[decodeURIComponent(p.slice(0, eq))] = decodeURIComponent(p.slice(eq + 1))
      } catch (e) { out[p.slice(0, eq)] = p.slice(eq + 1) }
    }
    return out
  }
  if (typeof qs.forEach === 'function') { qs.forEach(function (v, k) { out[k] = v }); return out }
  if (typeof qs === 'object') {
    for (var key in qs) {
      var val = qs[key]
      out[key] = val == null ? '' : String(val)
    }
  }
  return out
}

function parseBody(req) {
  if (!req.body) return {}
  try { return JSON.parse(req.body) } catch (e) { return {} }
}

function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms) }) }

function fetchWithTimeout(url, options, timeoutMs) {
  options = options || {}
  // QuickJS 宿主 fetch 不一定支持 AbortSignal，超时兜底用 race。
  // 注意：输掉 race 的一方必须挂上 catch，否则 unhandled rejection
  // 会被宿主当作插件异常导致 VM 重载（onDeinit → 任务静默停止）。
  var timerId
  var timer = new Promise(function (_, rej) {
    timerId = setTimeout(function () { rej(new Error('请求超时 ' + url.slice(0, 80))) }, timeoutMs || 15000)
  })
  timer.catch(function () {}) // 吸收败者 rejection
  return Promise.race([
    fetch(url, options).then(
      function (r) { clearTimeout(timerId); return r },
      function (e) { clearTimeout(timerId); throw e }
    ),
    timer
  ])
}

// 硬超时包装：给任意 Promise（jsenv 创建/销毁等无超时参数的调用）兜底，
// 防止单个步骤永久挂起导致取消请求无法生效
function withTimeout(p, ms, label) {
  var timer = new Promise(function (_, rej) {
    setTimeout(function () { rej(new Error((label || '操作') + ' 超时(' + Math.round(ms / 1000) + 's)')) }, ms)
  })
  timer.catch(function () {}) // 败者吸收，避免 unhandled rejection
  return Promise.race([Promise.resolve(p), timer])
}

// 仅用于 GitHub 爬取链路（树 API / 脚本下载）。
// 音频链接校验（verifyUrl）和洛雪网关调用不走这里。
// 镜像与代理互斥（绝不同时用于同一请求），候选顺序：
//   常规：加速镜像 → jsDelivr → 直连 → 代理直连（最后兜底）
//   强制代理（config.forceProxy）：代理 → 加速镜像 → jsDelivr → 直连
function buildCandidates(url) {
  var proxy = (config && config.proxy) || ''
  var out = []
  var mirrorUrl = null, mirrorUrl2 = null, jsdUrl = null
  if (url.indexOf('https://raw.githubusercontent.com/') === 0) {
    var rest = url.slice('https://raw.githubusercontent.com/'.length) // owner/repo/ref/path...
    if (config && config.ghMirror) {
      var mbase = String(config.ghMirror).trim().replace(/\/+$/, '')
      if (mbase) {
        // 镜像有两种拼接流派，并非所有站都兼容两种（如 gh1.lhl.one 仅前缀式），
        // 两种候选都入链，由回退机制自动选择可用者
        mirrorUrl = mbase + '/' + rest // 路径式：mirror/owner/repo/ref/path
        mirrorUrl2 = mbase + '/' + url // 前缀式：mirror/https://raw.githubusercontent.com/...
      }
    }
    // jsDelivr：raw/owner/repo/ref/path → cdn.jsdelivr.net/gh/owner/repo@ref/path
    var m = rest.match(/^([^/]+)\/([^/]+)\/(HEAD|[^/]+)\/(.*)$/)
    if (m) jsdUrl = 'https://cdn.jsdelivr.net/gh/' + m[1] + '/' + m[2] + '@' + (m[3] === 'HEAD' ? 'main' : m[3]) + '/' + m[4]
  }
  function add(u, useProxy) { if (u) out.push({ url: u, useProxy: useProxy }) }
  var force = !!(config && config.forceProxy && proxy)
  if (force) add(url, true)
  add(mirrorUrl, false)
  add(mirrorUrl2, false)
  add(jsdUrl, false)
  add(url, false)
  if (!force && proxy) add(url, true)
  return out.length ? out : [{ url: url, useProxy: false }]
}

function crawlFetch(url, options, timeoutMs) {
  options = options || {}
  var candidates = buildCandidates(url)
  var i = 0
  function doFetch(c, t) {
    var opts = {}
    for (var k in options) opts[k] = options[k]
    if (c.useProxy && config.proxy) opts.proxy = config.proxy
    return fetchWithTimeout(c.url, opts, t).then(function (res) {
      // 有些"镜像"站对任意路径都返回 200 + 网站 HTML 首页（如已转型的 Docker 加速站），
      // 若照单全收会把 HTML 当脚本内容存库。GitHub 爬取链路永远不会合法地返回 HTML，视为候选失败。
      var ct = ''
      try { ct = String((res.headers && res.headers.get('content-type')) || '') } catch (e) {}
      if (/text\/html/i.test(ct) && i < candidates.length) return attempt()
      return res
    })
  }
  function attempt() {
    if (i >= candidates.length) {
      var last = candidates[candidates.length - 1]
      return doFetch(last, timeoutMs || 15000) // 全失败时抛最后候选的错误
    }
    var c = candidates[i++]
    var t = i > 1 ? Math.min(timeoutMs || 15000, 10000) : (timeoutMs || 15000) // 回退候选用更短超时
    return doFetch(c, t).then(function (res) {
      if (!res.ok && res.status >= 500 && i < candidates.length) return attempt() // 5xx 换下一候选
      if (res.status === 403 || res.status === 429) { // 镜像限流，换下一候选
        if (i < candidates.length) return attempt()
      }
      return res
    }).catch(function (err) {
      if (i < candidates.length) return attempt()
      throw err
    })
  }
  return attempt()
}

// ==================== 疑似音源识别 ====================
function classifyEntry(path, content) {
  var fname = path.split('/').pop() || ''
  var score = 0
  if (/音源|源|source|lx-source/i.test(fname)) score += 2
  if (/^(lx|src|source)[-_ .]/i.test(fname)) score += 1
  if (content) {
    if (/globalThis\.lx\b|globalThis\[.lx.\]/.test(content)) score += 3
    if (/EVENT_NAMES/.test(content)) score += 2
    if (/lx\.on\s*\(|LX\.on\s*\(/.test(content)) score += 2
    if (/musicSources|musicUrl/.test(content)) score += 2
    if (/@name\s|@description\s/.test(content)) score += 1
    if (/on\(\s*['"]request['"]/.test(content)) score += 2
  }
  return score >= 5
}

// ==================== 路由 ====================
function createRouter() {
  var routes = []
  function add(method, pattern, handler) {
    routes.push({ method: method, segs: pattern.split('/').filter(Boolean), handler: handler })
  }
  return {
    get: function (p, h) { add('GET', p, h) },
    post: function (p, h) { add('POST', p, h) },
    delete: function (p, h) { add('DELETE', p, h) },
    handle: function (req) {
      // 兜底：若宿主把 query 拼进 path（req.query 为空），先拆出来，避免搜索/筛选参数丢失
      var full = String(req.path || '')
      var qm = full.indexOf('?')
      if (qm >= 0 && !req.query) {
        req.query = full.slice(qm + 1)
        req.path = full.slice(0, qm)
      }
      var segs = String(req.path || '').split('/').filter(Boolean)
      for (var i = 0; i < routes.length; i++) {
        var r = routes[i]
        if (r.method !== req.method || r.segs.length !== segs.length) continue
        var ok = true
        for (var j = 0; j < r.segs.length; j++) {
          if (r.segs[j] !== segs[j]) { ok = false; break }
        }
        if (ok) return r.handler(req)
      }
      return errResp(404, 'not found: ' + req.method + ' ' + req.path)
    }
  }
}

var router = createRouter()

// ---------- 统计 ----------
router.get('/api/stats', function () {
  var list = Object.keys(db.sources).map(function (k) { return db.sources[k] })
  var stats = {
    total: list.length,
    ok: 0, dead: 0, unknown: 0, suspected: 0, usable: 0,
    importedCount: Object.keys(imported).length,
    lastCrawl: db.lastCrawl || 0,
    job: { running: job.running, type: job.type, progress: job.progress }
  }
  for (var i = 0; i < list.length; i++) {
    var e = list[i]
    if (e.status === 'ok') stats.ok++
    else if (e.status === 'dead') stats.dead++
    else stats.unknown++
    if (e.suspected) stats.suspected++
    if (e.usable) stats.usable++
  }
  return jsonResp(stats)
})

// ---------- 来源列表 ----------
router.get('/api/sources', function (req) {
  var q = parseQuery(req.query)
  var kw = (q.q || '').toLowerCase()
  var filter = q.filter || 'all' // all | suspected | usable | ok | dead
  var limit = parseInt(q.limit || '500', 10)
  var rows = []
  var keys = Object.keys(db.sources)
  for (var i = 0; i < keys.length; i++) {
    var e = db.sources[keys[i]]
    if (kw && (e.name + ' ' + e.repo + ' ' + e.path).toLowerCase().indexOf(kw) === -1) continue
    if (filter === 'suspected' && !e.suspected) continue
    if (filter === 'usable' && !e.usable) continue
    if (filter === 'ok' && e.status !== 'ok') continue
    if (filter === 'dead' && e.status !== 'dead') continue
    rows.push(e)
  }
  rows.sort(function (a, b) {
    if (!!b.usable !== !!a.usable) return b.usable ? 1 : -1
    if (!!b.suspected !== !!a.suspected) return b.suspected ? 1 : -1
    return String(a.id).localeCompare(String(b.id))
  })
  return jsonResp({ total: rows.length, sources: rows.slice(0, limit) })
})

// ---------- 日志 ----------
router.get('/api/logs', function (req) {
  var q = parseQuery(req.query)
  var after = parseInt(q.after || '0', 10)
  var rows = logBuf.filter(function (l) { return l.seq > after })
  return jsonResp({ logs: rows, seq: logSeq })
})

// ---------- 配置 / 仓库管理 ----------
router.get('/api/config', function () {
  return jsonResp({
    proxy: config.proxy || '',
    ghMirror: config.ghMirror || '',
    mirrorPresets: MIRROR_PRESETS,
    forceProxy: !!config.forceProxy,
    deepCheck: !!config.deepCheck,
    maxDeepCheck: config.maxDeepCheck,
    builtinRepos: DEFAULT_REPOS,
    customRepos: config.customRepos || [],
    ghTokenSet: !!config.ghToken
  })
})
router.post('/api/config', function (req) {
  var b = parseBody(req)
  if (typeof b.proxy === 'string') config.proxy = b.proxy.trim()
  if (typeof b.ghMirror === 'string') config.ghMirror = b.ghMirror.trim()
  if (typeof b.forceProxy === 'boolean') config.forceProxy = b.forceProxy
  if (typeof b.deepCheck === 'boolean') config.deepCheck = b.deepCheck
  if (typeof b.maxDeepCheck === 'number') config.maxDeepCheck = Math.max(1, Math.min(500, b.maxDeepCheck))
  if (Array.isArray(b.reposOverride)) config.reposOverride = b.reposOverride.map(function (s) { return String(s).trim() }).filter(Boolean)
  if (typeof b.ghToken === 'string' && b.ghToken.trim()) {
    config.ghToken = b.ghToken.trim()
    log('GitHub Token 已保存（API 限额提升到 5000 次/小时）', '设置')
  }
  return songloft.storage.set(CFG_KEY, JSON.stringify(config)).then(function () {
    var netDesc = config.forceProxy && config.proxy ? '强制代理 ' + config.proxy
      : config.ghMirror ? '镜像 ' + config.ghMirror
      : config.proxy ? '代理 ' + config.proxy
      : '直连'
    log('设置已保存（爬取链路：' + netDesc + '）', '设置')
    return jsonResp({ ok: true })
  })
})

var REPO_RE = /^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/

// ---------- 镜像预设与可用性测试 ----------
var MIRROR_PRESETS = [
  'https://proxy.vvvv.ee',
  'https://ghproxy.net',
  'https://gh-proxy.com',
  'https://ghfast.top',
  'https://gh1.lhl.one'
]
// 探针文件：git/git 仓库的 README，长期稳定，任何 raw 镜像都应能拉到
var PROBE_RAW = 'https://raw.githubusercontent.com/git/git/master/README.md'
var PROBE_REST = PROBE_RAW.slice('https://raw.githubusercontent.com/'.length)

router.post('/api/test-mirror', function (req) {
  var b = parseBody(req)
  var mbase = String(b.mirror || '').trim()
  if (!mbase) return errResp(400, '缺少 mirror 参数')
  if (!/^https?:\/\//i.test(mbase)) mbase = 'https://' + mbase
  mbase = mbase.replace(/\/+$/, '')
  // 两种拼接流派都测（并非所有镜像都兼容两种，如 gh1.lhl.one 仅前缀式）
  var variants = [
    { style: '路径式', url: mbase + '/' + PROBE_REST },
    { style: '前缀式', url: mbase + '/' + PROBE_RAW }
  ]
  function testOne(v) {
    var t0 = Date.now()
    return fetchWithTimeout(v.url, { headers: { 'User-Agent': UA } }, 8000).then(function (res) {
      var ct = ''
      try { ct = String((res.headers && res.headers.get('content-type')) || '') } catch (e) {}
      return res.text().then(function (txt) {
        var isHtml = /text\/html/i.test(ct) || /^\s*<(!doctype|html)[\s>]/i.test(txt.slice(0, 500))
        var ok = res.ok && !isHtml && txt.length > 50
        var err = ''
        if (!res.ok) err = 'HTTP ' + res.status
        else if (isHtml) err = '返回的是网页而不是文件（假 200）'
        else if (txt.length <= 50) err = '内容过短'
        return { style: v.style, latencyMs: Date.now() - t0, ok: ok, status: res.status, bytes: txt.length, error: err }
      })
    }).catch(function (e) {
      return { style: v.style, latencyMs: Date.now() - t0, ok: false, status: 0, bytes: 0, error: (e && e.message || String(e) + '').slice(0, 120) }
    })
  }
  return variants.reduce(function (chain, v) {
    return chain.then(function (acc) { return testOne(v).then(function (r) { acc.push(r); return acc }) })
  }, Promise.resolve([])).then(function (results) {
    var usable = results.filter(function (r) { return r.ok })
    log('镜像测试 ' + mbase + '：' + (usable.length ? usable.map(function (r) { return r.style + ' ' + r.latencyMs + 'ms' }).join(' / ') : '全部失败'), '设置')
    return jsonResp({ mirror: mbase, ok: usable.length > 0, results: results })
  })
})

router.post('/api/repos/add', function (req) {
  var b = parseBody(req)
  var repo = String(b.repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '')
  if (!REPO_RE.test(repo)) return errResp(400, '仓库格式无效，应为 owner/repo（如 guoyue2010/lxmusic-）')
  if (DEFAULT_REPOS.indexOf(repo) !== -1) return errResp(400, '该仓库已在内置仓库中，无需添加')
  if (!Array.isArray(config.customRepos)) config.customRepos = []
  if (config.customRepos.indexOf(repo) !== -1) return errResp(400, '该仓库已添加过，无需重复添加')
  config.customRepos.push(repo)
  return songloft.storage.set(CFG_KEY, JSON.stringify(config)).then(function () {
    log('已添加仓库：' + repo, '设置')
    return jsonResp({ ok: true, customRepos: config.customRepos })
  })
})
router.post('/api/repos/remove', function (req) {
  var b = parseBody(req)
  var repo = String(b.repo || '').trim()
  if (!Array.isArray(config.customRepos)) config.customRepos = []
  var i = config.customRepos.indexOf(repo)
  if (i === -1) return errResp(404, '仅可删除手动添加的仓库')
  config.customRepos.splice(i, 1)
  return songloft.storage.set(CFG_KEY, JSON.stringify(config)).then(function () {
    log('已删除仓库：' + repo, '设置')
    return jsonResp({ ok: true, customRepos: config.customRepos })
  })
})

// ---------- 任务控制 ----------
router.post('/api/crawl', function () {
  if (job.running) return errResp(409, '已有任务在运行: ' + job.type)
  startJob('crawl')
  return jsonResp({ started: true })
})
router.post('/api/check', function (req) {
  if (job.running) return errResp(409, '已有任务在运行: ' + job.type)
  var b = parseBody(req)
  startJob('check', { suspectedOnly: !!b.suspectedOnly })
  return jsonResp({ started: true })
})
router.post('/api/cancel', function () {
  if (!job.running) return errResp(409, '没有正在运行的任务')
  if (!job.cancelRequested) {
    job.cancelRequested = true
    job.cancelAt = Date.now()
    log('收到取消请求，正在停止任务…', '任务')
    armCancelReaper()
  }
  return jsonResp({ cancelRequested: true })
})
router.get('/api/job', function (req) {
  var q = parseQuery(req.query)
  var after = parseInt(q.after || '0', 10)
  return jsonResp({
    running: job.running, type: job.type, progress: job.progress,
    tick: job.tick || 0, cancelRequested: !!job.cancelRequested,
    logs: logBuf.filter(function (l) { return l.seq > after }), seq: logSeq
  })
})

// ---------- 导出 ----------
router.get('/api/export', function () {
  var usable = []
  var keys = Object.keys(db.sources)
  for (var i = 0; i < keys.length; i++) {
    var e = db.sources[keys[i]]
    if (e.usable) usable.push({ name: e.name, repo: e.repo, path: e.path, url: e.url, platforms: e.deep ? e.deep.platforms : {} })
  }
  return jsonResp({ exportedAt: new Date().toISOString(), count: usable.length, sources: usable })
})

// ---------- 灌入洛雪 / 撤回 ----------
function lxGateway(path_) {
  return songloft.plugin.getHostUrl().then(function (hostUrl) {
    return songloft.plugin.getToken().then(function (token) {
      return { url: hostUrl.replace(/\/$/, '') + '/api/v1/jsplugin/lxmusic' + path_, token: token }
    })
  })
}

function lxApi(method, path_, bodyObj) {
  return lxGateway(path_).then(function (gw) {
    var opts = {
      method: method,
      headers: { 'Authorization': 'Bearer ' + gw.token, 'Content-Type': 'application/json' }
    }
    if (bodyObj !== undefined) opts.body = JSON.stringify(bodyObj)
    return fetchWithTimeout(gw.url, opts, 30000).then(function (res) {
      return res.text().then(function (text) {
        var data = null
        try { data = text ? JSON.parse(text) : null } catch (e) {}
        return { status: res.status, ok: res.status < 400, data: data, text: text }
      })
    })
  })
}

// lxmusic 的 filename 由 URL 末段推导（非 .js 结尾会补 .js）
// ---------- 纯 JS sha256（QuickJS 无 crypto 模块；用于音源内容级去重） ----------
function sha256Bytes(bytes) {
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)) }
  var K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]
  var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]
  var l = bytes.length
  var padded = new Uint8Array((((l + 8) >> 6) << 6) + 64)
  padded.set(bytes)
  padded[l] = 0x80
  var dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, Math.floor(l / 0x20000000))
  dv.setUint32(padded.length - 4, (l << 3) >>> 0)
  var w = new Uint32Array(64)
  for (var i = 0; i < padded.length; i += 64) {
    for (var j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4)
    for (var j = 16; j < 64; j++) {
      var s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3)
      var s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10)
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
    for (var j = 0; j < 64; j++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      var ch = (e & f) ^ (~e & g)
      var t1 = (h + S1 + ch + K[j] + w[j]) >>> 0
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      var maj = (a & b) ^ (a & c) ^ (b & c)
      var t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }
  var out = ''
  for (var i = 0; i < 8; i++) out += ('00000000' + H[i].toString(16)).slice(-8)
  return out
}

function sha256Str(s) {
  // UTF-8 编码后哈希
  var bytes = []
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) < 0xe000) {
      var cp = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00)
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return sha256Bytes(new Uint8Array(bytes))
}

function lxSourceFilename(e) {
  var u = (e && e.url) || ''
  var seg = u.split('?')[0].split('#')[0].split('/').pop() || 'source.js'
  var name = seg
  try { name = decodeURIComponent(seg) } catch (err) {}
  if (!/\.js$/i.test(name)) name += '.js'
  return name
}

// ---------- lxmusic 响应信封与名称匹配 ----------
// lxmusic 的 API 响应是 {code:0, msg, data} 信封格式，业务数据在 data 字段
function unwrapResp(r) {
  var d = r && r.data
  if (d && typeof d === 'object' && !Array.isArray(d) && typeof d.code !== 'undefined' && 'data' in d) return d.data
  return d
}
// 从音源脚本头部提取 @name（lxmusic 的音源名/id 都来自它）
function lxNameFromScript(text) {
  var m = String(text || '').match(/@name\s+(.+)/)
  return m ? m[1].trim() : ''
}
// 名称归一：去掉分隔符/装饰符后比较（"全豆要[聚合音源]" 与 "全豆要|聚合音源" 视为同名）
function normName(s) {
  return String(s || '').toLowerCase().replace(/[^0-9a-z\u4e00-\u9fa5\u3400-\u4dbf]+/g, '')
}
// 拉取 lxmusic 音源列表（已解信封，返回数组；失败返回 null）
function lxListSources() {
  return lxApi('GET', '/api/sources').then(function (r) {
    var d = unwrapResp(r)
    if (Array.isArray(d)) return d
    if (d && Array.isArray(d.list)) return d.list
    return null
  }).catch(function () { return null })
}
// 在列表中匹配音源：优先 @name 归一匹配，其次文件名匹配；多条命中取最后一条（lxmusic 后导入的在前位置不定，取最新语义）
function matchLxSource(list, entry, lxName) {
  if (!list || !list.length) return null
  var nm = normName(lxName || (entry && (entry.lxName || entry.scriptName || entry.name)))
  var fname = lxSourceFilename(entry)
  var last = null
  for (var i = 0; i < list.length; i++) {
    var s = list[i]
    if (!s) continue
    if ((nm && normName(s.name) === nm) || (fname && s.filename === fname)) last = s
  }
  return last
}
// 兜底：解析 lxmusic 日志（GET /api/logs），从「音源导入成功: id=xx, name=xx, filename=xx」中取 id
function lxIdFromLogs(entry, lxName) {
  return lxApi('GET', '/api/logs').then(function (r) {
    var d = unwrapResp(r)
    var logs = Array.isArray(d) ? d : (d && Array.isArray(d.logs) ? d.logs : [])
    if (!logs.length) return ''
    var nm = normName(lxName || (entry && (entry.lxName || entry.scriptName || entry.name)))
    var fname = lxSourceFilename(entry)
    for (var i = logs.length - 1; i >= 0; i--) {
      var l = logs[i]
      var msg = typeof l === 'string' ? l : String((l && (l.message || l.msg)) || '')
      var m = msg.match(/音源导入成功[:：]\s*id=([^,，\s]+),\s*name=([^,，]*),\s*filename=([^\s",，]+)/)
      if (!m) continue
      if (m[3] === fname || (nm && normName(m[2]) === nm)) return m[1]
    }
    return ''
  }).catch(function () { return '' })
}

function saveImported() { return songloft.storage.set(IMPORTED_KEY, JSON.stringify(imported)) }

router.get('/api/imported', function () {
  var rows = []
  var keys = Object.keys(imported)
  for (var i = 0; i < keys.length; i++) {
    var e = db.sources[keys[i]]
    var imp = imported[keys[i]]
    rows.push({
      entryId: keys[i],
      lxId: imp.lxId || '',
      name: (e && (e.scriptName || e.name)) || imp.name,
      gone: !!imp.gone,
      importedAt: imp.importedAt,
      platforms: e && e.deep ? e.deep.platforms : {},
      url: e ? e.url : ''
    })
  }
  rows.sort(function (a, b) { return b.importedAt - a.importedAt })
  return jsonResp({ total: rows.length, imported: rows })
})

// 同步洛雪状态：给缺失 lxId 的旧记录补全 id；标记洛雪中已不存在的记录
router.post('/api/reconcile', function () {
  if (importState.running) return errResp(409, '导入任务进行中，稍后再试')
  return lxListSources().then(function (list) {
    if (!list) return errResp(502, '无法获取洛雪音源列表（lxmusic 未运行或网关异常）')
    var updated = 0, matched = 0, missing = 0, dirty = false
    var keys = Object.keys(imported)
    for (var i = 0; i < keys.length; i++) {
      var entryId = keys[i]
      var imp = imported[entryId]
      var hit = matchLxSource(list, { lxName: imp.lxName, scriptName: imp.name, name: imp.name, url: imp.url }, imp.lxName)
      if (hit && hit.id) {
        matched++
        if (String(imp.lxId || '') !== String(hit.id)) { imp.lxId = String(hit.id); updated++; dirty = true }
        if (imp.gone) { imp.gone = false; dirty = true }
      } else {
        missing++
        if (!imp.gone) { imp.gone = true; dirty = true }
      }
    }
    var fin = dirty ? saveImported() : Promise.resolve()
    return fin.then(function () {
      log('同步洛雪状态：匹配 ' + matched + ' 个' + (updated ? '，补全/修正 id ' + updated + ' 个' : '') + (missing ? '，洛雪中已不存在 ' + missing + ' 个' : ''), '灌入')
      return jsonResp({ ok: true, total: keys.length, matched: matched, updated: updated, missing: missing })
    })
  })
})

router.post('/api/import', function (req) {
  if (importState.running) return errResp(409, '导入任务进行中')
  var b = parseBody(req)
  var ids = Array.isArray(b.ids) ? b.ids : []
  if (!ids.length) return errResp(400, '请至少勾选 1 个实测可用的音源')
  var targets = []
  var depSkipped = []
  for (var i = 0; i < ids.length; i++) {
    var e = db.sources[ids[i]]
    if (!e) return errResp(400, '音源不存在: ' + ids[i])
    if (e.deprecated) {
      // 已废弃（同内容/旧版本）：作为跳过结果返回，不报错也不灌入
      depSkipped.push({ id: e.id, name: e.scriptName || e.name, status: 'skipped', message: '已废弃（' + (e.dupReason || '重复') + '），跳过' })
      continue
    }
    if (!e.usable) return errResp(400, '「' + (e.scriptName || e.name) + '」未通过可用性检测，不能灌入')
    targets.push(e)
  }
  if (!targets.length) return errResp(400, '所选音源均为重复/旧版本（已废弃），无需灌入')
  importState.running = true
  importState.cancelRequested = false
  importState.results = depSkipped
  importState.total = targets.length + depSkipped.length
  runImport(targets)
  return jsonResp({ started: true, count: targets.length })
})

router.post('/api/import-cancel', function () {
  if (!importState.running) return errResp(409, '没有进行中的导入')
  importState.cancelRequested = true
  return jsonResp({ cancelRequested: true })
})

router.get('/api/import-status', function () {
  var done = 0, current = null
  for (var i = 0; i < importState.results.length; i++) {
    var r = importState.results[i]
    if (r.status === 'importing') current = r.name
    else done++
  }
  return jsonResp({
    running: importState.running,
    total: importState.total || importState.results.length,
    done: done,
    current: current,
    results: importState.results
  })
})

var importState = { running: false, cancelRequested: false, results: [], total: 0 }

function recordImported(entry, lx) {
  imported[entry.id] = {
    lxId: lx,
    name: entry.scriptName || entry.name,
    lxName: entry.lxName || entry.scriptName || entry.name || '',
    url: entry.url || '',
    importedAt: Date.now(),
    contentHash: entry.contentHash || ''
  }
  return saveImported()
}

// 导入后确认 lxmusic 侧 id：① import-url 响应信封内层的 id → ② 按 @name/文件名匹配列表 → ③ 兜底解析 lxmusic 日志
function resolveLxId(entry, respData, lxName) {
  var rec = unwrapResp(respData)
  if (rec && typeof rec === 'object' && rec.id) return Promise.resolve(String(rec.id))
  return lxListSources().then(function (list) {
    var hit = matchLxSource(list, entry, lxName)
    if (hit && hit.id) return String(hit.id)
    return lxIdFromLogs(entry, lxName)
  })
}

function runImport(targets) {
  // 预处理：补全内容哈希 → 三层去重（已灌入同内容 / 批内同内容择优 / 洛雪同名保护）→ 逐个灌入
  var queue = []
  var idx = 0

  function usableCount(e) {
    var n = 0
    var p = (e.deep && e.deep.platforms) || {}
    for (var s in p) if (p[s].status === 'usable') n++
    return n
  }
  function verRank(e) {
    var v = String((e.deep && e.deep.version) || '').match(/\d+(\.\d+)*/)
    if (!v) return 0
    var parts = v[0].split('.'), n = 0
    for (var i = 0; i < parts.length && i < 4; i++) n = n * 1000 + parseInt(parts[i], 10)
    return n
  }
  function rank(a, b) {
    // 文件更新时间新者优先（同名异源=同一源的迭代，保留最后更新的）→ 可用平台多者 → 版本新者 → id 稳定排序
    return (b.lastModified || 0) - (a.lastModified || 0) || usableCount(b) - usableCount(a) || verRank(b) - verRank(a) || String(a.id).localeCompare(String(b.id))
  }

  function plan(list, knownIds) {
    var importedHashes = {}
    for (var eid in imported) if (imported[eid].contentHash) importedHashes[imported[eid].contentHash] = imported[eid].name
    // 洛雪现有音源按名称归一建索引（lxmusic 的音源名来自脚本 @name，同名导入时它自己会替换删除，正常不会重名）
    var byName = {}
    if (Array.isArray(list)) {
      for (var li = 0; li < list.length; li++) {
        var s = list[li]
        if (s && s.name) byName[normName(s.name)] = s
      }
    }
    // 批内分组：内容相同 → 择优；@name 相同（内容不同）→ 也择优，避免灌入 5 个"全豆要"变体
    var best = {}, groups = {}, nbest = {}, ngroups = {}
    for (var i = 0; i < targets.length; i++) {
      var e0 = targets[i]
      if (e0.contentHash) (groups[e0.contentHash] = groups[e0.contentHash] || []).push(e0)
      var nm0 = normName(e0.lxName || e0.scriptName || e0.name)
      if (nm0) (ngroups[nm0] = ngroups[nm0] || []).push(e0)
    }
    for (var k in groups) { groups[k].sort(rank); best[k] = groups[k][0] }
    for (var nk in ngroups) { ngroups[nk].sort(rank); nbest[nk] = ngroups[nk][0] }
    for (var i = 0; i < targets.length; i++) {
      var e = targets[i]
      var k = e.contentHash || ''
      var nm = normName(e.lxName || e.scriptName || e.name)
      if (k && importedHashes[k]) { queue.push({ e: e, skip: '内容与已灌入的「' + importedHashes[k] + '」相同，跳过' }); continue }
      if (k && best[k] && best[k] !== e) { queue.push({ e: e, skip: '与本次所选的「' + (best[k].scriptName || best[k].name) + '」内容相同，跳过（保留可用平台更多的版本）' }); continue }
      if (nm && nbest[nm] && nbest[nm] !== e) { queue.push({ e: e, skip: '与本次所选的「' + (nbest[nm].scriptName || nbest[nm].name) + '」同名（视为同一音源的新旧版本），跳过（保留文件更新时间/版本最新的）' }); continue }
      var exist = nm && byName[nm]
      if (exist && !knownIds[String(exist.id)]) { queue.push({ e: e, skip: '洛雪已存在同名音源「' + exist.name + '」（非本插件灌入），跳过以避免覆盖' }); continue }
      queue.push({ e: e })
    }
  }

  var prep = Promise.all(targets.map(function (e) {
    if (e.contentHash && e.lxName) return null
    // 旧数据没有哈希 / @name：现下载补算（失败则哈希标记为空，不做内容去重）
    return crawlFetch(e.url, { headers: { 'User-Agent': UA } }, config.checkTimeoutMs).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status)
      if (!e.lastModified) {
        try {
          var lm = res.headers && res.headers.get('last-modified')
          if (lm) e.lastModified = Date.parse(lm) || 0
        } catch (e2) {}
      }
      return res.text()
    }).then(function (text) {
      if (!e.contentHash) e.contentHash = sha256Str(text)
      if (!e.lxName) e.lxName = lxNameFromScript(text)
    }).catch(function () { if (!e.contentHash) e.contentHash = '' })
  })).then(function () {
    return lxListSources().then(function (list) {
      var knownIds = {}
      for (var eid in imported) if (imported[eid].lxId) knownIds[String(imported[eid].lxId)] = true
      plan(list, knownIds) // 列表拿不到（null）就不做同名保护，其余去重照常
    })
  })

  function next() {
    if (idx >= queue.length || importState.cancelRequested) { importState.running = false; return }
    var item = queue[idx++]
    var e = item.e
    var name = e.scriptName || e.name
    if (item.skip) {
      importState.results.push({ id: e.id, name: name, status: 'skipped', message: item.skip })
      log('跳过灌入：' + name + ' — ' + item.skip, '灌入', 'warn')
      return setTimeout(next, 50)
    }
    importState.results.push({ id: e.id, name: name, status: 'importing' })
    lxApi('POST', '/api/sources/import-url', { url: e.url }).then(function (r) {
      var msg = r.ok ? '' : (String((r.data && r.data.error) || r.text || ('HTTP ' + r.status)).slice(0, 160))
      if (!r.ok) {
        importState.results[importState.results.length - 1] = { id: e.id, name: name, status: 'failed', message: msg }
        log('灌入失败：' + name + ' — ' + msg, '灌入', 'warn')
        return
      }
      return resolveLxId(e, r.data).then(function (lxId) {
        return recordImported(e, lxId).then(function () {
          importState.results[importState.results.length - 1] = { id: e.id, name: name, status: 'success', lxId: lxId }
          log('已灌入洛雪：' + name + (lxId ? '（id=' + lxId + '）' : ''), '灌入')
        })
      })
    }).catch(function (err) {
      importState.results[importState.results.length - 1] = {
        id: e.id, name: name, status: 'failed', message: String(err && err.message || err).slice(0, 160)
      }
      log('灌入失败：' + name + ' — ' + (err && err.message || err), '灌入', 'warn')
    }).then(function () {
      setTimeout(next, 800) // 轻微限速，给 lxmusic 加载脚本的时间
    })
  }

  prep.then(function () { next() }).catch(function (e) {
    importState.running = false
    log('灌入预处理失败：' + (e && e.message || e), '灌入', 'error')
  })
}

// ---------- 撤回灌入（从 lxmusic 删除本插件灌入的音源） ----------
router.post('/api/revoke', function (req) {
  if (importState.running) return errResp(409, '导入任务进行中，稍后再试')
  var b = parseBody(req)
  var entryIds = b.all ? Object.keys(imported) : (Array.isArray(b.ids) ? b.ids : [])
  if (!entryIds.length) return errResp(400, '请至少选择 1 个已灌入的音源')
  var results = []
  var idx = 0
  function next() {
    if (idx >= entryIds.length) return Promise.resolve()
    var entryId = entryIds[idx++]
    var imp = imported[entryId]
    if (!imp) { results.push({ entryId: entryId, status: 'skipped', message: '无灌入记录' }); return next() }
    var name = imp.name
    if (!imp.lxId) {
      // 没拿到 lxmusic 侧 id（旧记录），只能提示手动处理
      delete imported[entryId]
      results.push({ entryId: entryId, name: name, status: 'failed', message: '缺少 lxmusic 侧 id，请在洛雪插件中手动删除' })
      return next()
    }
    return lxApi('DELETE', '/api/sources?id=' + encodeURIComponent(imp.lxId)).then(function (r) {
      if (r.ok) {
        delete imported[entryId]
        results.push({ entryId: entryId, name: name, status: 'success' })
        log('已从洛雪撤回：' + name, '撤回')
      } else if (r.status === 404) {
        delete imported[entryId] // 洛雪里已经没有了
        results.push({ entryId: entryId, name: name, status: 'success', message: '洛雪中已不存在' })
      } else {
        results.push({ entryId: entryId, name: name, status: 'failed', message: String((r.data && r.data.error) || ('HTTP ' + r.status)).slice(0, 120) })
        log('撤回失败：' + name + ' — ' + ((r.data && r.data.error) || ('HTTP ' + r.status)), '撤回', 'warn')
      }
    }).catch(function (err) {
      results.push({ entryId: entryId, name: name, status: 'failed', message: String(err && err.message || err).slice(0, 120) })
    }).then(function () { return sleep(300) }).then(next)
  }
  return next().then(function () {
    return saveImported().then(function () {
      var ok = results.filter(function (r) { return r.status === 'success' }).length
      return jsonResp({ total: results.length, success: ok, results: results })
    })
  }).catch(function (e) {
    return errResp(500, String(e && e.message || e).slice(0, 160))
  })
})

// ==================== 任务：爬取 + 检测 ====================
var heartbeatTimer = null
function touchTick() { job.tick = Date.now() }
function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(function () {
    if (!job.running) { stopHeartbeat(); return }
    var idle = Date.now() - (job.tick || 0)
    if (idle > 300000) { // 5 分钟无任何进展：判定卡死，释放任务位便于重新发起
      log('任务已 5 分钟无进展，疑似卡住，自动结束。可直接重新点击「开始爬取 / 可用性检测」。', '任务', 'error')
      job.running = false
      stopHeartbeat()
      saveDbSoon().catch(function () {})
      return
    }
    log('任务心跳：' + job.type + ' 运行中（最近活动 ' + Math.round(idle / 1000) + 's 前）', '任务')
  }, 60000)
}

// 取消后 20 秒当前步骤仍未让出（如沙箱调用挂死），强制释放任务位，保证取消必然生效
function armCancelReaper() {
  setTimeout(function () {
    if (job.running && job.cancelRequested) {
      log('取消超时（当前步骤未能及时响应），已强制结束任务。可直接重新发起。', '任务', 'warn')
      job.running = false
      stopHeartbeat()
      saveDbSoon().catch(function () {})
    }
  }, 20000)
}
function stopHeartbeat() { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null } }

function startJob(type, opts) {
  job = { running: true, type: type, cancelRequested: false, progress: {}, tick: Date.now() }
  startHeartbeat()
  var p = job.progress
  if (type === 'crawl') {
    p.reposTotal = allRepos().length
    p.reposDone = 0
    p.linksFound = 0
    p.added = 0
    runCrawl().then(function () { return runCheckPhase(opts || {}) }).catch(function (e) {
      log('任务异常: ' + (e && e.message || e), '任务', 'error')
    }).then(function () {
      job.running = false
      stopHeartbeat()
      log('任务结束', '任务')
      return saveDbSoon()
    })
  } else {
    runCheckPhase(opts || {}).catch(function (e) {
      log('任务异常: ' + (e && e.message || e), '任务', 'error')
    }).then(function () {
      job.running = false
      stopHeartbeat()
      log('任务结束', '任务')
      return saveDbSoon()
    })
  }
}

function ghTreeUrl(repo) {
  return 'https://api.github.com/repos/' + repo + '/git/trees/HEAD?recursive=1'
}

function extractCandidates(tree, repo) {
  var out = []
  var items = (tree.tree || [])
  for (var i = 0; i < items.length; i++) {
    var item = items[i]
    if (item.type !== 'blob' || !/\.js$/i.test(item.path || '')) continue
    if (/(^|\/)(node_modules|test|tests|__tests__|dist\/assets)\//.test(item.path)) continue
    if (/(webpack|vite|rollup|babel|jest|eslint|tsconfig)[^/]*\.js$/i.test(item.path)) continue
    out.push(item.path)
    if (out.length >= config.maxCandidatesPerRepo) break
  }
  return out
}

function allRepos() {
  var out = DEFAULT_REPOS.slice()
  if (Array.isArray(config.customRepos)) {
    for (var i = 0; i < config.customRepos.length; i++) {
      if (out.indexOf(config.customRepos[i]) === -1) out.push(config.customRepos[i])
    }
  }
  return out
}

// 爬取前查配额：/rate_limit 端点本身不消耗配额
function checkQuota(need) {
  return fetchWithTimeout('https://api.github.com/rate_limit', { headers: ghHeaders() }, 8000)
    .then(function (res) { return res.text() })
    .then(function (text) {
      var j
      try { j = JSON.parse(text) } catch (e) { return { ok: true } }
      var core = (j.resources && j.resources.core) || {}
      if (typeof core.remaining !== 'number') return { ok: true }
      log('GitHub API 配额：剩余 ' + core.remaining + '/' + core.limit +
        (config.ghToken ? '（Token）' : '（未配 Token，未认证每小时仅 60 次）'), '爬取')
      if (core.remaining < need) {
        var mins = core.reset ? Math.max(1, Math.ceil((core.reset * 1000 - Date.now()) / 60000)) : 60
        return {
          ok: false,
          msg: 'GitHub API 配额不足（剩余 ' + core.remaining + '，本次需 ' + need + '），约 ' + mins + ' 分钟后重置。' +
            (config.ghToken ? '请检查 Token 是否有效。' : '建议在设置中免费申请一个 GitHub Token 填入（限额提升到 5000 次/小时），或稍后重试。')
        }
      }
      return { ok: true }
    })
    .catch(function () { return { ok: true } }) // 配额查询失败不阻塞，按原流程跑
}

function runCrawl() {
  var repos = allRepos()
  var idx = 0
  log('开始爬取 ' + repos.length + ' 个仓库…', '爬取')
  function crawlOne() {
    if (job.cancelRequested || idx >= repos.length) return Promise.resolve()
    touchTick()
    var repo = repos[idx++]
    job.progress.reposDone = idx
    return fetchWithTimeout(ghTreeUrl(repo), { headers: ghHeaders() }, 20000)
      .then(function (res) { return res.text() })
      .then(function (text) {
        var tree
        try { tree = JSON.parse(text) } catch (e) { throw new Error('响应解析失败') }
        if (tree.message) throw new Error('GitHub API: ' + String(tree.message).slice(0, 80))
        if (tree.truncated) log('警告：' + repo + ' 文件树被截断，可能漏掉部分文件', '爬取', 'warn')
        var paths = extractCandidates(tree, repo)
        var added = 0
        for (var i = 0; i < paths.length; i++) {
          var id = repo + '::' + paths[i]
          if (!db.sources[id]) {
            var fname = paths[i].split('/').pop()
            db.sources[id] = {
              id: id, repo: repo, path: paths[i],
              url: 'https://raw.githubusercontent.com/' + repo + '/HEAD/' + paths[i].split('/').map(encodeURIComponent).join('/'),
              name: fname.replace(/\.js$/i, ''),
              status: 'unknown', suspected: null, usable: false,
              size: 0, addedAt: Date.now(), lastCheck: 0, deep: null
            }
            added++
          }
          job.progress.linksFound++
        }
        job.progress.added += added
        log(repo + '：候选 ' + paths.length + ' 个，新增 ' + added, '爬取')
      })
      .catch(function (e) {
        var msg = (e && e.message) || String(e)
        if (/rate limit exceeded/i.test(msg)) {
          // 配额耗尽：立即中止，避免逐个仓库撞墙白等
          log('GitHub API 配额已耗尽，中止本次爬取（已处理 ' + idx + '/' + repos.length + ' 个仓库，已收录数据不受影响）。' +
            (config.ghToken ? '请检查 Token 是否有效。' : '可在设置中填写 GitHub Token 提升限额，或约 1 小时后重试。'), '爬取', 'error')
          idx = repos.length
        } else {
          log(repo + ' 爬取失败: ' + msg, '爬取', 'warn')
        }
      })
      .then(function () { return sleep(400) })
      .then(crawlOne)
  }
  return checkQuota(repos.length).then(function (q) {
    if (!q.ok) { log(q.msg, '爬取', 'error'); return }
    return crawlOne()
  }).then(function () {
    db.lastCrawl = Date.now()
    log('爬取完成：共 ' + Object.keys(db.sources).length + ' 条链接', '爬取')
  })
}

// ---------- 下载 + 基础检测 ----------
function checkEntryBasic(entry) {
  entry.lastCheck = Date.now()
  return crawlFetch(entry.url, { headers: { 'User-Agent': UA } }, config.checkTimeoutMs)
    .then(function (res) {
      if (!res.ok) { entry.status = 'dead'; entry.error = 'HTTP ' + res.status; return }
      return res.text().then(function (text) {
        if (text.length > MAX_CONTENT_BYTES) { entry.status = 'dead'; entry.error = '文件过大'; return }
        entry.size = text.length
        entry.contentHash = sha256Str(text)
        entry.status = 'ok'
        entry.error = null
        // 源文件最后更新时间（HTTP Last-Modified）：入库去重"保留最新"的依据
        entry.lastModified = 0
        try {
          var lm0 = res.headers && res.headers.get('last-modified')
          if (lm0) entry.lastModified = Date.parse(lm0) || 0
        } catch (e0) {}
        var wasSuspected = entry.suspected
        entry.suspected = classifyEntry(entry.path, text)
        if (entry.suspected && !wasSuspected) log('疑似音源：' + entry.name, '检测')
        // 提取脚本元信息里的名字与版本（同名不同版废弃判断的依据）
        var m = text.match(/@name\s+(.+)/)
        if (m && m[1] && m[1].trim()) entry.scriptName = m[1].trim().slice(0, 60)
        var mv = text.match(/@version\s+(.+)/)
        if (mv && mv[1] && mv[1].trim()) entry.scriptVersion = mv[1].trim().slice(0, 30)
      })
    })
    .catch(function (e) {
      entry.status = 'dead'
      entry.error = String(e && e.message || e).slice(0, 120)
    })
}

// ---------- 可用性检测（jsenv 沙箱）----------
function sanitizeEnvName(id) {
  var out = ''
  for (var i = 0; i < id.length; i++) {
    var c = id.charCodeAt(i)
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45) out += id[i]
    else out += '_' + c.toString(16)
  }
  return 'hunter_' + out.slice(0, 60)
}

// 下载音源脚本内容：走 crawlFetch 候选链（镜像 → jsDelivr → 直连 → 代理），与爬取同路
function fetchText(url, timeoutMs) {
  return crawlFetch(url, { headers: { 'User-Agent': UA } }, timeoutMs || 15000).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return res.text()
  })
}

// 魔数 + content-type 校验（参考 lxmusic Probe + 我们 Node 版实现）
function looksAudio(headAscii, b0, b1) {
  if (headAscii.slice(0, 3) === 'ID3') return true
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0) return true
  var four = headAscii.slice(0, 4)
  if (four === 'fLaC' || four === 'OggS' || four === 'RIFF') return true
  if (headAscii.slice(4, 8) === 'ftyp') return true
  return false
}

function verifyUrl(url) {
  return new Promise(function (resolve) {
    var u
    try { u = new URL(url) } catch (e) { resolve({ ok: false, reason: '无效 URL' }); return }
    var host = (u.hostname || '').toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)) {
      resolve({ ok: false, reason: '私有/本地地址，疑似假链接' }); return
    }
    fetchWithTimeout(url, {
      headers: { 'Range': 'bytes=0-16383', 'User-Agent': UA }
    }, 12000).then(function (res) {
      var ct = ''
      try { ct = res.headers.get('content-type') || '' } catch (e) {}
      if (/json|text\/html|text\/plain/i.test(ct)) { resolve({ ok: false, reason: '返回 ' + ct + '，非音频' }); return }
      if (!res.ok && res.status !== 206) { resolve({ ok: false, reason: 'HTTP ' + res.status }); return }
      return res.arrayBuffer().then(function (ab) {
        var bytes = new Uint8Array(ab)
        var ascii = ''
        for (var i = 0; i < Math.min(bytes.length, 16); i++) ascii += String.fromCharCode(bytes[i])
        var audioOk = looksAudio(ascii, bytes[0], bytes[1]) || /audio|octet-stream/i.test(ct)
        resolve(audioOk ? { ok: true, size: bytes.length } : { ok: false, reason: '非音频内容 (' + (ct || '未知') + ')' })
      })
    }).catch(function (e) {
      resolve({ ok: false, reason: String(e && e.message || e).slice(0, 80) })
    })
  })
}

function extractMeta(code) {
  var meta = { name: '', description: '', version: '', author: '', homepage: '' }
  var block = code.match(/\/\*[!*][\s\S]*?\*\//)
  if (!block) return meta
  var pairs = { name: /@name\s+(.+)/, version: /@version\s+(.+)/, description: /@description\s+(.+)/, author: /@author\s+(.+)/, homepage: /@homepage\s+(.+)/ }
  for (var k in pairs) {
    var m = block[0].match(pairs[k])
    if (m && m[1]) meta[k] = m[1].trim()
  }
  return meta
}

function deepCheckViaJsenv(entry, code) {
  var envName = sanitizeEnvName(entry.id)
  var result = { checkedAt: Date.now(), loadable: false, loadError: null, inited: false, platforms: {} }
  function cleanup() { return withTimeout(songloft.jsenv.destroy(envName).catch(function () {}), 8000, '销毁沙箱') }

  var meta = extractMeta(code)
  result.version = meta.version
  result.lxName = meta.name || ''   // 脚本 @name，同名分辨/洛雪匹配用
  result.author = meta.author || ''
  var infoCode = 'globalThis.lx.currentScriptInfo = ' + JSON.stringify({
    name: meta.name, description: meta.description, version: meta.version,
    author: meta.author, homepage: meta.homepage, rawScript: code
  }) + ';'

  return withTimeout(songloft.jsenv.create(envName, BOOTSTRAP), 15000, '创建沙箱').then(function () {
    return withTimeout(songloft.jsenv.execute(envName, infoCode, 5000), 8000, '注入 scriptInfo').then(function (r) {
      if (r && r.error) throw new Error('注入 scriptInfo 失败: ' + String(r.error).slice(0, 120))
    })
  }).then(function () {
    return withTimeout(songloft.jsenv.executeWait(envName, code, 30000, ['inited']), 40000, '脚本初始化').then(function (r) {
      if (r.error) { result.loadError = String(r.error).slice(0, 200); return cleanup().then(function () { return result }) }
      var initedEv = null
      for (var i = 0; i < (r.events || []).length; i++) if (r.events[i].name === 'inited') initedEv = r.events[i]
      if (!initedEv) { result.loadError = '脚本未调用 lx.send(\'inited\', …)'; return cleanup().then(function () { return result }) }
      result.loadable = true
      result.inited = true
      // 逐平台测试
      return testPlatforms(envName, result).then(function () {
        return cleanup().then(function () { return result })
      })
    })
  }).catch(function (e) {
    result.loadError = String(e && e.message || e).slice(0, 200)
    return cleanup().then(function () { return result })
  })
}

function testPlatforms(envName, result) {
  var queue = PLATFORMS.slice()
  var reqCounter = 0
  function next() {
    if (!queue.length) return Promise.resolve()
    var src = queue.shift()
    var songs = TEST_SONGS[src] || []
    if (!songs.length) { result.platforms[src] = { status: 'skipped', message: '无测试歌曲' }; return next() }
    var lastMsg = ''
    var trySong = function (i) {
      if (i >= songs.length || job.cancelRequested) {
        result.platforms[src] = { status: 'failed', message: lastMsg || '未知失败' }
        return Promise.resolve()
      }
      var song = songs[i]
      var reqId = 'hq_' + Date.now() + '_' + (reqCounter++)
      var payload = { source: src, action: 'musicUrl', info: { type: '128k', musicInfo: song.info } }
      var code = 'lx._dispatch(' + JSON.stringify(reqId) + ', "request", ' + JSON.stringify(payload) + ');'
      // 每次取链尝试都算"活动"：防止单条音源耗时过长被 5 分钟 watchdog 误杀
      touchTick()
      return withTimeout(songloft.jsenv.executeWait(envName, code, 20000, ['dispatchResult', 'dispatchError']), 30000, '取链请求').then(function (r) {
        if (r.error) { lastMsg = '「' + song.name + '」' + String(r.error).slice(0, 80); return trySong(i + 1) }
        var ev = null
        for (var j = 0; j < (r.events || []).length; j++) {
          var name = r.events[j].name
          if (name !== 'dispatchResult' && name !== 'dispatchError') continue
          var data
          try { data = JSON.parse(r.events[j].data) } catch (e) { continue }
          if (data.id !== reqId) continue
          ev = { name: name, data: data }
          break
        }
        if (!ev) { lastMsg = '「' + song.name + '」无响应'; return trySong(i + 1) }
        if (ev.name === 'dispatchError') { lastMsg = '「' + song.name + '」' + String(ev.data.error || '脚本失败').slice(0, 80); return trySong(i + 1) }
        var ret = ev.data.result
        if (typeof ret === 'string' && ret.indexOf('http') === 0) {
          return verifyUrl(ret).then(function (v) {
            if (v.ok) {
              result.platforms[src] = { status: 'usable', message: '测试歌曲「' + song.name + '」返回真实音频' }
              return Promise.resolve()
            }
            lastMsg = '「' + song.name + '」链接不可播: ' + v.reason
            return trySong(i + 1)
          })
        }
        lastMsg = ret == null || ret === '' ? '「' + song.name + '」返回空链接' : '「' + song.name + '」返回异常: ' + String(ret).slice(0, 60)
        return trySong(i + 1)
      })
    }
    return trySong(0).then(next)
  }
  // 平台间串行（沙箱环境复用同一 env），整体足够快
  return next()
}

// ---------- 入库去重：同内容 / 同名旧版本 直接废弃，不参与可用性检测 ----------
// 名称归一与版本号剥离（与前端 normName 思路一致）
function bNormName(s) {
  return String(s || '').toLowerCase().replace(/[\[\]【】（）()|｜:：、,，.。\s_\-·•]+/g, '')
}
function stripVersionTail(s) {
  return String(s || '').replace(/\s*[vV]?\d+(\.\d+)*(-[A-Za-z0-9.]+)?\s*$/, '')
}
function versionNum(s) {
  var m = String(s || '').match(/[vV]?(\d+(?:\.\d+)+)/)
  if (!m) return 0
  var parts = m[1].split('.'), v = 0
  for (var i = 0; i < Math.min(parts.length, 4); i++) v = v * 1000 + (parseInt(parts[i], 10) || 0)
  return v
}
// a 是否比 b 更值得保留：文件更新时间 → 版本号 → 已测可用 → id 稳定排序
function betterKeeper(a, b) {
  var la = a.lastModified || 0, lb = b.lastModified || 0
  if (la !== lb) return la > lb
  var va = versionNum(a.scriptVersion || (a.scriptName || a.name))
  var vb = versionNum(b.scriptVersion || (b.scriptName || b.name))
  if (va !== vb) return va > vb
  if (!!a.usable !== !!b.usable) return !!a.usable
  return String(a.id) < String(b.id)
}
function dedupeSources() {
  var all = Object.keys(db.sources).map(function (k) { return db.sources[k] })
  var res = { dupContent: 0, oldVersion: 0 }
  function dep(d, kept, kind) {
    d.deprecated = true
    d.dupOf = kept.id
    d.dupReason = kind === 'dupContent' ? '同内容重复' : '同名旧版本'
    d.usable = false
  }
  // 1) 内容完全相同：只保留一条
  var byHash = {}
  for (var i = 0; i < all.length; i++) {
    var e = all[i]
    if (e.deprecated || e.status !== 'ok' || !e.contentHash) continue
    var k = e.contentHash
    if (!byHash[k]) { byHash[k] = e; continue }
    var keep = betterKeeper(e, byHash[k]) ? e : byHash[k]
    var drop = keep === e ? byHash[k] : e
    dep(drop, keep, 'dupContent')
    res.dupContent++
    byHash[k] = keep
  }
  // 2) 同源同名不同版（版本号剥离后同名）：只保留最新
  var byFam = {}
  for (var j = 0; j < all.length; j++) {
    var e2 = all[j]
    if (e2.deprecated || e2.status !== 'ok') continue
    var fam = bNormName(stripVersionTail(e2.scriptName || e2.name))
    if (!fam) continue
    if (!byFam[fam]) { byFam[fam] = e2; continue }
    var keep2 = betterKeeper(e2, byFam[fam]) ? e2 : byFam[fam]
    var drop2 = keep2 === e2 ? byFam[fam] : e2
    dep(drop2, keep2, 'oldVersion')
    res.oldVersion++
    byFam[fam] = keep2
  }
  res.total = res.dupContent + res.oldVersion
  return res
}

// ---------- 检测阶段 ----------
function runCheckPhase(opts) {
  var suspectedOnly = opts && opts.suspectedOnly
  var all = Object.keys(db.sources).map(function (k) { return db.sources[k] })
  // 1) 基础可达性检测：所有 unknown 或 已失效的（复验）
  var toCheck = all.filter(function (e) { return e.status === 'unknown' || e.status === 'dead' })
  job.progress.checkTotal = toCheck.length
  job.progress.checkDone = 0
  log('基础检测 ' + toCheck.length + ' 条…', '检测')
  var idx = 0
  var CONCURRENCY = 4
  var savedSince = 0
  function worker() {
    return Promise.resolve().then(function loop() {
      if (job.cancelRequested || idx >= toCheck.length) return Promise.resolve()
      touchTick()
      var entry = toCheck[idx++]
      job.progress.checkDone++
      return checkEntryBasic(entry).then(function () {
        // 阶段中途定期落盘：VM 意外重载时不至于整段丢失
        if (job.progress.checkDone - savedSince >= 20) {
          savedSince = job.progress.checkDone
          return saveDbSoon().catch(function () {}).then(loop)
        }
        return loop()
      })
    })
  }
  var basicDone = Promise.all([worker(), worker(), worker(), worker()])

  // 2) 可用性检测（jsenv 沙箱实测取链）；检测前先入库去重——同内容/同名旧版本直接废弃，不浪费时间
  return basicDone.then(function () {
    var dd = dedupeSources()
    if (dd.total) log('入库去重：废弃 ' + dd.total + ' 条（同内容 ' + dd.dupContent + ' / 同名旧版本 ' + dd.oldVersion + '），不参与可用性检测', '检测')
    if (!config.deepCheck || job.cancelRequested) return
    var targets = all.filter(function (e) {
      if (e.deprecated) return false // 已废弃（重复/旧版本）：绝不参与可用性检测
      if (!e.suspected || e.status !== 'ok') return false
      if (suspectedOnly && e.deep && e.deep.checkedAt) return false
      return true
    })
    // 优先没测过的；连续检测直到全部测完（按 maxDeepCheck 分批仅为进度展示，不再截断）
    targets.sort(function (a, b) { return (a.deep ? a.deep.checkedAt : 0) - (b.deep ? b.deep.checkedAt : 0) })
    var batchSize = Math.max(1, config.maxDeepCheck)
    job.progress.deepTotal = targets.length
    job.progress.deepDone = 0
    log('可用性检测 ' + targets.length + ' 个音源（jsenv 沙箱）…', '可用性')
    var didx = 0
    function nextDeep() {
      if (job.cancelRequested || didx >= targets.length) return Promise.resolve()
      touchTick()
      var entry = targets[didx++]
      job.progress.deepDone = didx
      return crawlFetch(entry.url, { headers: { 'User-Agent': UA } }, config.checkTimeoutMs).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status)
        // 源文件最后更新时间（HTTP Last-Modified），同名异源"只保留最新"的排序依据；拿不到为 0
        entry.lastModified = 0
        try {
          var lm = res.headers && res.headers.get('last-modified')
          if (lm) entry.lastModified = Date.parse(lm) || 0
        } catch (e2) {}
        return res.text()
      }).then(function (code) {
        entry.contentHash = sha256Str(code)
        return deepCheckViaJsenv(entry, code).then(function (r) {
          entry.deep = r
          entry.usable = false
          var usablePlats = []
          for (var s in r.platforms) if (r.platforms[s].status === 'usable') usablePlats.push(s)
          entry.usable = usablePlats.length > 0
          log((entry.usable ? '✔ 可用[' + usablePlats.join('/') + ']：' : '✘ 不可用：') + entry.name + (r.loadError ? '（' + r.loadError + '）' : ''), '可用性', entry.usable ? 'info' : 'warn')
        })
      }).catch(function (e) {
        entry.deep = { checkedAt: Date.now(), loadable: false, loadError: String(e && e.message || e).slice(0, 160), platforms: {} }
        entry.usable = false
        log('可用性检测异常：' + entry.name + ' — ' + (e && e.message || e), '可用性', 'warn')
      }).then(function () {
        // 落盘加兜底超时：storage 假死时不至于卡住整个检测队列
        return withTimeout(saveDbSoon(), 15000, '落盘').catch(function () {}).then(function () { return sleep(200) }).then(function () {
          if (didx === targets.length) log('可用性检测全部完成：' + didx + '/' + targets.length, '可用性')
          else if (didx % batchSize === 0) log('已测完 ' + didx + ' 个，自动继续下一批…', '可用性')
          else if (didx % 10 === 0) log('可用性检测进度：' + didx + '/' + targets.length, '可用性')
          return nextDeep()
        })
      })
    }
    return nextDeep()
  })
}

// ==================== 生命周期 ====================
// v1.4.3 关键修复：宿主会同步等待 onInit 返回的 Promise settle，而热重载「冻结」
// 状态下 storage 等异步调用可能被挂起 —— 一旦挂起即全进程死锁（v1.4.2 真机复现：
// hot reload 后连其它插件都停止响应，只能重启容器）。
// 因此 onInit/onDeinit 一律【同步返回】，绝不把 Promise 交给宿主；数据加载转后台，
// 由 onHTTPRequest 入口的 ensureLoaded 兜底等待（带超时，防 storage 永挂）。
var loadPromise = null
function ensureLoaded() {
  if (!loadPromise) {
    loadPromise = initChain().catch(function (e) {
      log('初始化异常: ' + (e && e.message || e), '系统', 'error')
    })
  }
  return loadPromise
}

function initChain() {
  return songloft.storage.get(CFG_KEY).then(function (raw) {
    try { config = raw ? JSON.parse(raw) : null } catch (e) { config = null }
    if (!config) {
      config = {
        repos: DEFAULT_REPOS.slice(),
        deepCheck: true,
        maxDeepCheck: 60,
        checkTimeoutMs: 15000,
        maxCandidatesPerRepo: 300,
        maxContentBytes: MAX_CONTENT_BYTES,
        forceProxy: false,
        ghToken: ''
      }
    }
    if (!Array.isArray(config.repos) || !config.repos.length) config.repos = DEFAULT_REPOS.slice()
    return songloft.storage.get(DB_KEY)
  }).then(function (raw) {
    if (raw) {
      try {
        var parsed = JSON.parse(raw)
        if (parsed && parsed.sources) db = parsed
      } catch (e) { log('数据库损坏，已重置', '系统', 'warn') }
    }
    // 恢复灌入记录（宿主重启/重载后已灌入列表与撤回都依赖它）
    return songloft.storage.get(IMPORTED_KEY)
  }).then(function (raw) {
    if (raw) {
      try {
        var imp = JSON.parse(raw)
        if (imp && typeof imp === 'object') imported = imp
      } catch (e) { log('灌入记录损坏，已忽略', '系统', 'warn') }
    }
    log('初始化完成：' + Object.keys(db.sources).length + ' 条已收录链接' +
      (Object.keys(imported).length ? '，' + Object.keys(imported).length + ' 条灌入记录' : ''), '系统')
  })
}

globalThis.onInit = function () {
  log('音源猎手插件初始化…', '系统')
  ensureLoaded() // 后台加载，不阻塞宿主
  // 同步返回：宿主拿到非 Promise 值立即继续，杜绝热重载死锁
}

globalThis.onDeinit = function () {
  job.cancelRequested = true
  stopHeartbeat()
  saveDbSoon().catch(function () {}) // 后台落盘，不阻塞宿主 deinit
}

globalThis.onHTTPRequest = function (req) {
  // 首个请求前确保数据已加载完成（onInit 为异步后台加载）；8s 超时兜底防 storage 挂起
  var ready = ensureLoaded()
  return Promise.race([
    ready,
    new Promise(function (resolve) { setTimeout(resolve, 8000) })
  ]).then(function () {
    return router.handle(req)
  }).then(function (resp) {
    if (!resp || typeof resp !== 'object') return errResp(500, 'handler returned non-object')
    return resp
  }).catch(function (e) {
    var msg = e && e.message ? e.message : String(e)
    log('请求处理异常 ' + req.method + ' ' + req.path + ': ' + msg, '系统', 'error')
    return errResp(500, msg)
  })
}
