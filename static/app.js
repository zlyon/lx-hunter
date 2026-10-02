'use strict'
/* 音源猎手前端 — 源库 / 灌入 / 设置（左侧导航） */
var BASE = '/api/v1/jsplugin/lx-hunter/api'
/* 插件 API 走宿主鉴权（JWT）。token 来源按优先级：
   ① 宿主注入 common.js 提供的 SongloftPlugin.getAuthToken()
   ② iframe URL 的 ?access_token= 查询参数
   ③ localStorage 中形如 JWT 的 token（auth bridge 写入） */
function resolveToken() {
  try {
    var t = window.SongloftPlugin && window.SongloftPlugin.getAuthToken && window.SongloftPlugin.getAuthToken()
    if (t) return String(t)
  } catch (e) {}
  var m = location.search.match(/[?&]access_token=([^&]+)/)
  if (m) return decodeURIComponent(m[1])
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i) || ''
      if (!/token/i.test(k)) continue
      var v = localStorage.getItem(k) || ''
      if (v.indexOf('eyJ') === 0) return v
      try { var o = JSON.parse(v); if (o && (o.access_token || o.accessToken)) return o.access_token || o.accessToken } catch (e) {}
    }
  } catch (e) {}
  return ''
}
var TOKEN = resolveToken()
function withAuth(path, opts) {
  if (!TOKEN) TOKEN = resolveToken()
  opts = opts || {}
  if (TOKEN) {
    var h = opts.headers || {}
    h['Authorization'] = 'Bearer ' + TOKEN
    opts.headers = h
    path += (path.indexOf('?') >= 0 ? '&' : '?') + 'access_token=' + encodeURIComponent(TOKEN)
  }
  return { path: path, opts: opts }
}
var _missingEls = {}
function $(id) {
  var el = document.getElementById(id)
  if (!el && !_missingEls[id]) {
    // 缺失元素只告警一次：页面顶部红色横幅，绝不静默
    _missingEls[id] = true
    try {
      var bar = document.createElement('div')
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#c0392b;color:#fff;padding:8px 14px;font:13px/1.5 sans-serif'
      bar.textContent = '⚠ 界面初始化异常：缺少元素 #' + id + '，部分功能不可用。请强制刷新页面（Ctrl+F5）；仍复现请重新安装插件。'
      document.body.appendChild(bar)
    } catch (e) {}
  }
  return el
}
/* 安全读值：元素缺失返回默认值，不拖垮整次保存 */
function $val(id, dft) { var el = $(id); return el ? el.value : dft }
function $chk(id) { var el = $(id); return !!(el && el.checked) }
function api(path, opts) {
  var w = withAuth(path, opts)
  return fetch(BASE + w.path, w.opts).then(function (r) {
    return r.text().then(function (t) {
      var d = {}
      try { d = JSON.parse(t) } catch (e) { d = { error: t } }
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status))
      return d
    })
  })
}
function fmtSize(n) {
  if (!n) return '—'
  if (n < 1024) return n + 'B'
  if (n < 1048576) return (n / 1024).toFixed(1) + 'K'
  return (n / 1048576).toFixed(1) + 'M'
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  })
}
function fmtTime(ts) {
  if (!ts) return '—'
  var t = new Date(ts)
  return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2) +
    ' ' + ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2)
}
function debounce(fn, ms) {
  var t
  return function () { clearTimeout(t); t = setTimeout(fn, ms) }
}

var PLATS = ['wy', 'tx', 'kw', 'kg', 'mg']
var PLAT_NAME = { wy: '网易', tx: 'QQ', kw: '酷我', kg: '酷狗', mg: '咪咕' }
var lastLogSeq = 0
var crawlRunning = false

/* ---------- 左侧导航切换 ---------- */
var navBtns = document.querySelectorAll('.nav-item')
function closeDrawer() {
  var side = document.querySelector('.side')
  var bd = $('drawerBackdrop')
  if (side) side.classList.remove('open')
  if (bd) bd.classList.remove('show')
}
for (var ti = 0; ti < navBtns.length; ti++) {
  navBtns[ti].onclick = function () {
    for (var j = 0; j < navBtns.length; j++) navBtns[j].classList.remove('active')
    this.classList.add('active')
    var views = document.querySelectorAll('.view')
    for (var k = 0; k < views.length; k++) views[k].classList.remove('active')
    $('pane-' + this.getAttribute('data-view')).classList.add('active')
    if (this.getAttribute('data-view') === 'import') refreshImportTab()
    if (this.getAttribute('data-view') === 'settings') refreshSettings()
    closeDrawer() // 移动端：选完页面自动收起抽屉
  }
}
/* 移动端抽屉：汉堡按钮开、遮罩关 */
onClick('btnMenu', function () {
  var side = document.querySelector('.side')
  var bd = $('drawerBackdrop')
  if (side) side.classList.add('open')
  if (bd) bd.classList.add('show')
})
bindEl('drawerBackdrop', 'onclick', closeDrawer)

/* ---------- 源库 ---------- */
function refreshStats() {
  return api('/stats').then(function (s) {
    $('stTotal').textContent = s.total
    $('stOk').textContent = s.ok
    $('stSus').textContent = s.suspected
    $('stUsable').textContent = s.usable
    $('stImported').textContent = s.importedCount || 0
    return s
  })
}

function lightsHtml(platforms) {
  return '<span class="lights">' + PLATS.map(function (p) {
    var st = platforms && platforms[p] ? platforms[p].status : ''
    var cls = st === 'usable' ? 'up' : (st === 'failed' ? 'down' : '')
    var tip = platforms && platforms[p] ? esc(platforms[p].message || '') : '未检测'
    return '<span class="light ' + cls + '" title="' + tip + '"><i></i>' + PLAT_NAME[p] + '</span>'
  }).join('') + '</span>'
}

function refreshSources() {
  var q = $('q').value.trim()
  var filter = $('filter').value
  var url = '/sources?limit=400&filter=' + encodeURIComponent(filter) + (q ? '&q=' + encodeURIComponent(q) : '')
  return api(url).then(function (d) {
    var rows = d.sources || []
    if (!rows.length) {
      $('rows').innerHTML = '<tr><td colspan="6" class="empty">暂无数据 — 点击「开始爬取」收录音源</td></tr>'
      return
    }
    $('rows').innerHTML = rows.map(function (e) {
      var statusHtml = '<span class="dot ' + e.status + '"></span>' +
        ({ ok: '可访问', dead: '失效', unknown: '待检测' }[e.status] || e.status) +
        (e.suspected ? '<span class="tag">音源</span>' : '') +
        (e.usable ? '<span class="tag usable">可用</span>' : '') +
        (e.deprecated ? '<span class="tag" title="' + esc(e.dupReason || '重复') + (e.dupOf ? '，保留 ' + e.dupOf : '') + '">弃用</span>' : '')
      var plats = (e.deep && e.deep.platforms)
        ? lightsHtml(e.deep.platforms)
        : (e.suspected ? '<span class="muted">待可用性检测</span>' : '—')
      return '<tr>' +
        '<td>' + statusHtml + '</td>' +
        '<td title="' + esc(e.path) + '">' + esc(e.scriptName || e.name) + '</td>' +
        '<td class="muted">' + esc(e.repo) + '</td>' +
        '<td>' + plats + '</td>' +
        '<td class="muted">' + fmtSize(e.size) + '</td>' +
        '<td><a href="' + esc(e.url) + '" target="_blank">打开</a></td>' +
        '</tr>'
    }).join('')
  })
}

function pollJob() {
  api('/job?after=' + lastLogSeq).then(function (d) {
    renderLogs(d.logs || [])
    var p = d.progress || {}
    var wrap = $('progWrap')
    if (d.running) {
      crawlRunning = true
      wrap.classList.add('show')
      if (d.cancelRequested) {
        $('btnCrawl').disabled = true
        $('btnCrawl').textContent = '取消中…'
      } else if ($('btnCrawl').textContent !== '取消任务') {
        $('btnCrawl').disabled = false
        $('btnCrawl').textContent = '取消任务'
        $('btnCrawl').classList.add('danger')
      }
      var label = d.type === 'crawl' ? '爬取中' : '检测中'
      var detail = ''
      var pct = 0
      if (d.type === 'crawl') {
        detail = '仓库 ' + (p.reposDone || 0) + '/' + (p.reposTotal || 0) + ' · 链接 ' + (p.linksFound || 0) + ' · 新增 ' + (p.added || 0)
        pct = p.reposTotal ? ((p.reposDone || 0) / p.reposTotal) * (p.checkTotal ? 30 : 90) : 5
      }
      if (p.checkTotal) {
        detail += (detail ? ' · ' : '') + '基础检测 ' + (p.checkDone || 0) + '/' + p.checkTotal
        pct = 30 + ((p.checkDone || 0) / p.checkTotal) * 40
      }
      if (p.deepTotal) {
        detail += ' · 可用性检测 ' + (p.deepDone || 0) + '/' + p.deepTotal
        pct = 70 + ((p.deepDone || 0) / p.deepTotal) * 30
      }
      $('progLabel').textContent = label
      var idleSec = d.tick ? Math.max(0, Math.round((Date.now() - d.tick) / 1000)) : null
      $('progDetail').textContent = detail + (idleSec != null ? ' · 最近活动 ' + idleSec + 's 前' : '')
      $('progBar').style.width = Math.min(pct, 100) + '%'
    } else {
      if (crawlRunning) {
        crawlRunning = false
        wrap.classList.remove('show')
        $('btnCrawl').disabled = false
        $('btnCrawl').textContent = '开始爬取'
        $('btnCrawl').classList.remove('danger')
        refreshStats().then(refreshSources)
      }
    }
  }).catch(function () {})
}

function renderLogs(logs) {
  // 按 seq 去重：即使后端 query 参数失效返回全量日志，也不会重复刷屏
  logs = logs.filter(function (l) { return l.seq > lastLogSeq })
  if (!logs.length) return
  var el = $('log')
  var atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30
  var html = logs.map(function (l) {
    var cls = l.level === 'error' ? 'error' : l.level === 'warn' ? 'warn' : (l.msg.indexOf('✔') === 0 || l.msg.indexOf('已灌入') === 0 ? 'ok' : '')
    var t = new Date(l.ts)
    var hh = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2)
    return '<div class="' + cls + '">[' + hh + '][' + esc(l.module) + '] ' + esc(l.msg) + '</div>'
  }).join('')
  el.insertAdjacentHTML('beforeend', html)
  while (el.childNodes.length > 800) el.removeChild(el.firstChild)
  if (atBottom) el.scrollTop = el.scrollHeight
  lastLogSeq = logs[logs.length - 1].seq
}

function guard(fn) {
  return function () {
    fn().catch(function (e) { alert(e.message || String(e)) })
  }
}
/* 安全绑定：元素缺失时跳过而不是抛错毁掉后续所有初始化 */
function onClick(id, fn) { var el = $(id); if (el) el.onclick = guard(fn) }
function bindEl(id, ev, fn) { var el = $(id); if (el) el[ev] = fn }
/* 名称归一：全豆要[聚合音源] ≈ 全豆要|聚合音源 ≈ 全豆要聚合音源 */
function normName(s) {
  return String(s || '').toLowerCase().replace(/[\[\]【】（）()|｜:：、,，.。\s_\-·•]+/g, '')
}
var autoSynced = false // 本次会话是否已自动同步过洛雪ID

onClick('btnCrawl', function () {
  if (crawlRunning) {
    // 立即给出反馈；取消超时/完成后由 pollJob 恢复按钮
    $('btnCrawl').disabled = true
    $('btnCrawl').textContent = '取消中…'
    return api('/cancel', { method: 'POST' })
  }
  return api('/crawl', { method: 'POST' }).then(function () { pollJob() })
})
onClick('btnCheck', function () {
  return api('/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then(function () { pollJob() })
})
onClick('btnExport', function () {
  return api('/export').then(function (d) {
    var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })
    var a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'lx-hunter-usable.json'
    a.click()
    URL.revokeObjectURL(a.href)
  })
})
bindEl('q', 'oninput', debounce(function () { refreshSources() }, 300))
bindEl('filter', 'onchange', function () { refreshSources() })
bindEl('chkShowDup', 'onchange', function () { refreshImportTab() })

/* ---------- 灌入页 ---------- */
function selectedChecks(tbodyId, attr) {
  var out = []
  var boxes = $(tbodyId).querySelectorAll('input[type=checkbox]:checked')
  for (var i = 0; i < boxes.length; i++) out.push(boxes[i].getAttribute(attr))
  return out
}

function refreshImportTab() {
  return Promise.all([api('/sources?limit=400&filter=usable'), api('/imported')]).then(function (rs) {
    var usable = rs[0].sources || []
    var importedRows = rs[1].imported || []
    var importedMap = {}
    for (var i = 0; i < importedRows.length; i++) importedMap[importedRows[i].entryId] = true

    // 内容级分组：同 contentHash 归为一组，组内择优（可用平台多 → 版本新）
    function platCount(e) {
      var n = 0, p = (e.deep && e.deep.platforms) || {}
      for (var s in p) if (p[s].status === 'usable') n++
      return n
    }
    function verNum(e) {
      var v = String((e.deep && e.deep.version) || '').match(/\d+(\.\d+)*/)
      if (!v) return 0
      var parts = v[0].split('.'), n = 0
      for (var j = 0; j < parts.length && j < 4; j++) n = n * 1000 + parseInt(parts[j], 10)
      return n
    }
    var groups = [], byHash = {}
    for (var i = 0; i < usable.length; i++) {
      var e0 = usable[i]
      var h = e0.contentHash || '#solo:' + e0.id
      if (!byHash[h]) { byHash[h] = []; groups.push(byHash[h]) }
      byHash[h].push(e0)
    }
    for (var g = 0; g < groups.length; g++) {
      groups[g].sort(function (a, b) { return platCount(b) - platCount(a) || verNum(b) - verNum(a) || String(a.id).localeCompare(String(b.id)) })
    }
    // 名称族：同名（归一后）不同内容 = 同一音源的更新迭代，族内只保留最新一个
    function famKey(e) { var nm = normName(e.scriptName || e.name); return nm ? 'n:' + nm : 'solo:' + e.id }
    function cmpLatest(a, b) {
      return (b.lastModified || 0) - (a.lastModified || 0) || verNum(b) - verNum(a) ||
        platCount(b) - platCount(a) || String(a.id).localeCompare(String(b.id))
    }
    var fams = [], byFam = {}
    for (var g = 0; g < groups.length; g++) {
      var fk = famKey(groups[g][0])
      if (!byFam[fk]) { byFam[fk] = []; fams.push(byFam[fk]) }
      byFam[fk].push(groups[g])
    }

    var showDup = !!($('chkShowDup') && $('chkShowDup').checked)
    var visible = [], dupHidden = 0, indepCount = 0
    for (var f = 0; f < fams.length; f++) {
      var fam = fams[f]
      var all = []
      for (var g = 0; g < fam.length; g++) all = all.concat(fam[g])
      indepCount++
      if (!showDup) {
        // 族内选"最新"的 hash 组，再取其最优条目作为唯一展示代表
        var bestGrp = fam[0]
        for (var g = 1; g < fam.length; g++) if (cmpLatest(fam[g][0], bestGrp[0]) < 0) bestGrp = fam[g]
        var rep = bestGrp[0]
        rep._dupN = bestGrp.length
        rep._isBest = true
        rep._famN = all.length
        rep._famOld = all.length - 1
        rep._famAll = all
        visible.push(rep)
        dupHidden += all.length - 1
      } else {
        var latestGrp = fam[0]
        for (var g = 0; g < fam.length; g++) if (cmpLatest(fam[g][0], latestGrp[0]) < 0) latestGrp = fam[g]
        for (var g = 0; g < fam.length; g++) {
          var grp = fam[g]
          for (var m = 0; m < grp.length; m++) {
            grp[m]._dupN = grp.length
            grp[m]._isBest = m === 0
            grp[m]._isOld = grp !== latestGrp
            grp[m]._famN = all.length
            grp[m]._famAll = all
            visible.push(grp[m])
          }
        }
      }
    }

    // 上面板只显示未灌入：族内任一条已灌入即整族隐藏（与灌入时同名保护口径一致）
    function famInLx(e) {
      var famAll = e._famAll || [e]
      for (var m = 0; m < famAll.length; m++) if (importedMap[famAll[m].id]) return true
      return false
    }
    var pending = []
    for (var f2 = 0; f2 < visible.length; f2++) if (!famInLx(visible[f2])) pending.push(visible[f2])

    if (!usable.length) {
      $('importRows').innerHTML = '<tr><td colspan="3" class="empty">暂无实测可用的音源 — 先在「源库」执行 爬取 + 可用性检测</td></tr>'
    } else if (!pending.length) {
      $('importRows').innerHTML = '<tr><td colspan="3" class="empty">所有实测可用音源均已灌入 ✓ 可在下方面板撤回后重新灌入</td></tr>'
    } else {
      $('importRows').innerHTML = pending.map(function (e) {
        var tags = ''
        if (e._dupN > 1) tags += e._isBest
          ? '<span class="tag" title="有 ' + (e._dupN - 1) + ' 个内容完全相同的音源，灌入时自动跳过其余">同内容 ×' + e._dupN + '（保留此条）</span>'
          : '<span class="tag" title="与此组保留条目内容完全相同，灌入时自动跳过">同内容重复</span>'
        if (e._isOld) tags += '<span class="tag" title="同名音源的旧版本（按文件更新时间/版本号判定），默认已折叠，灌入时会被同名保护跳过">同名旧版本</span>'
        else if (e._famN > 1) tags += '<span class="tag" title="同名音源视为同一源的更新迭代：共 ' + e._famN + ' 个，按文件更新时间/版本号只保留此最新版">同名保留最新 ×' + e._famN + '</span>'
        var tip = '路径: ' + esc(e.path) + '&#10;仓库: ' + esc(e.repo) +
          (e.deep && e.deep.lxName ? '&#10;@name: ' + esc(e.deep.lxName) : '') +
          (e.deep && e.deep.version ? '&#10;版本: ' + esc(e.deep.version) : '') +
          (e.lastModified ? '&#10;文件更新: ' + fmtTime(e.lastModified) : '') +
          (e.contentHash ? '&#10;内容指纹: ' + esc(String(e.contentHash).slice(0, 12)) : '')
        return '<tr>' +
          '<td><input type="checkbox" data-entry="' + esc(e.id) + '"></td>' +
          '<td title="' + tip + '">' + esc(e.scriptName || e.name) + tags + '</td>' +
          '<td>' + lightsHtml(e.deep && e.deep.platforms) + '</td>' +
          '</tr>'
      }).join('')
    }

    if (!importedRows.length) {
      $('revokeRows').innerHTML = '<tr><td colspan="5" class="empty">暂无灌入记录</td></tr>'
    } else {
      $('revokeRows').innerHTML = importedRows.map(function (r) {
        var lx = r.lxId
          ? esc(r.lxId)
          : '<span class="muted">未知</span>'
        if (r.gone) lx += ' <span class="tag" title="洛雪音源列表里找不到该音源，可能已被手动删除">已不存在</span>'
        return '<tr>' +
          '<td><input type="checkbox" data-entry="' + esc(r.entryId) + '"></td>' +
          '<td>' + esc(r.name) + '</td>' +
          '<td>' + lightsHtml(r.platforms) + '</td>' +
          '<td class="muted">' + lx + '</td>' +
          '<td class="muted">' + fmtTime(r.importedAt) + '</td>' +
          '</tr>'
      }).join('')
    }
    $('importMsg').textContent = '实测可用 ' + usable.length + ' 个 · 独立音源 ' + fams.length + ' 个 · 未灌入 ' + pending.length + ' 个 · 已灌入 ' + importedRows.length + ' 个' +
      (dupHidden ? ' · 已折叠同内容/旧版本 ' + dupHidden + ' 个（勾选上方开关可查看）' : '')
    var bImp = $('importBadge'); if (bImp) bImp.textContent = String(pending.length)
    var bRev = $('revokeBadge'); if (bRev) bRev.textContent = String(importedRows.length)
    // 旧记录缺洛雪 id：本次会话自动静默同步一次
    if (!autoSynced && importedRows.length && importedRows.some(function (r) { return !r.lxId })) {
      autoSynced = true
      syncLx(true)
    }
  })
}

$('chkAllImport').onchange = function () {
  var boxes = $('importRows').querySelectorAll('input[type=checkbox]')
  for (var i = 0; i < boxes.length; i++) boxes[i].checked = this.checked
}
$('chkAllRevoke').onchange = function () {
  var boxes = $('revokeRows').querySelectorAll('input[type=checkbox]')
  for (var i = 0; i < boxes.length; i++) boxes[i].checked = this.checked
}

onClick('btnDoImport', function () {
  var ids = selectedChecks('importRows', 'data-entry')
  if (!ids.length) { alert('请先勾选要灌入的音源（至少 1 个）'); return }
  if (!confirm('将所选 ' + ids.length + ' 个实测可用音源灌入洛雪音源插件？\n内容重复 / 洛雪已有同名（非本插件灌入）的会自动跳过，不会覆盖。')) return
  setImportBtns(false) // 发请求前先禁用，防止响应慢时连点
  return api('/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ids }) })
    .catch(function (e) { setImportBtns(true); throw e })
    .then(function () { watchImport() })
})

onClick('btnRevoke', function () {
  var ids = selectedChecks('revokeRows', 'data-entry')
  if (!ids.length) { alert('请先勾选要撤回的音源（至少 1 个）'); return }
  if (!confirm('从洛雪音源插件中删除所选 ' + ids.length + ' 个已灌入音源？')) return
  return doRevoke({ ids: ids })
})
onClick('btnRevokeAll', function () {
  if (!confirm('从洛雪音源插件中删除本插件灌入的全部音源？')) return
  return doRevoke({ all: true })
})

/* 灌入/撤回进行中：禁用全部操作按钮；灌入每秒轮询进度 */
var importTimer = null
function setImportBtns(on) {
  var ids = ['btnDoImport', 'btnRevoke', 'btnRevokeAll', 'btnRefreshImport', 'btnRefreshRevoke']
  for (var i = 0; i < ids.length; i++) $(ids[i]).disabled = !on
}
function watchImport() {
  setImportBtns(false)
  if (importTimer) return
  importTimer = setInterval(function () {
    api('/import-status').then(function (st) {
      if (st.running) {
        $('importMsg').textContent = '⏳ 灌入中 ' + (st.done || 0) + '/' + (st.total || 0) + (st.current ? '：' + st.current : '（正在下载脚本…）')
      } else {
        clearInterval(importTimer)
        importTimer = null
        setImportBtns(true)
        var rs = st.results || []
        var ok = rs.filter(function (r) { return r.status === 'success' }).length
        var skip = rs.filter(function (r) { return r.status === 'skipped' }).length
        var fail = rs.filter(function (r) { return r.status === 'failed' }).length
        alert('灌入完成：成功 ' + ok + ' 个' + (skip ? '，跳过 ' + skip + ' 个（内容重复 / 同名保护，见日志）' : '') + (fail ? '，失败 ' + fail + ' 个（见日志）' : ''))
        refreshImportTab()
        refreshStats()
      }
    }).catch(function () {})
  }, 1000)
}

function doRevoke(body) {
  setImportBtns(false)
  return api('/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (d) {
      setImportBtns(true)
      var fail = d.total - d.success
      alert('撤回完成：成功 ' + d.success + ' 个' + (fail ? '，失败/跳过 ' + fail + ' 个（见日志）' : ''))
      refreshImportTab()
      refreshStats()
    })
    .catch(function (e) { setImportBtns(true); throw e })
}
$('btnRefreshImport').onclick = guard(function () { return refreshImportTab() })
$('btnRefreshRevoke').onclick = guard(function () { return refreshImportTab() })

/* 同步洛雪ID：拉取洛雪音源列表，为旧记录补全 id、标记已不存在的音源 */
function syncLx(silent) {
  setImportBtns(false)
  return api('/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then(function (d) {
      setImportBtns(true)
      if (!silent) {
        alert('同步完成：匹配到洛雪音源 ' + d.matched + ' 个' +
          (d.updated ? '，补全/修正 id ' + d.updated + ' 个' : '') +
          (d.missing ? '，洛雪中已不存在 ' + d.missing + ' 个（见标记）' : ''))
      }
      return refreshImportTab()
    })
    .catch(function (e) { setImportBtns(true); if (!silent) throw e })
}
onClick('btnSyncLx', function () { return syncLx(false) })

/* ---------- 设置页 ---------- */
var BUILTIN = []
var MIRROR_PRESETS = []
var CUSTOM_OPT = '__custom__'
var NONE_OPT = '__none__'

function currentMirror() {
  var v = $('cfgMirrorSel').value
  if (v === NONE_OPT) return ''
  if (v === CUSTOM_OPT) return $('cfgMirror').value.trim()
  return v
}

function refreshMirrorSelect(saved) {
  var sel = $('cfgMirrorSel')
  var opts = ['<option value="' + NONE_OPT + '">不使用镜像</option>']
  for (var i = 0; i < MIRROR_PRESETS.length; i++) opts.push('<option value="' + esc(MIRROR_PRESETS[i]) + '">' + esc(MIRROR_PRESETS[i]) + '</option>')
  opts.push('<option value="' + CUSTOM_OPT + '">自定义…</option>')
  sel.innerHTML = opts.join('')
  var hit = MIRROR_PRESETS.indexOf(saved)
  if (saved && hit === -1) {
    sel.value = CUSTOM_OPT
    $('rowMirrorCustom').style.display = ''
    $('cfgMirror').value = saved
  } else if (saved) {
    sel.value = saved
    $('rowMirrorCustom').style.display = 'none'
  } else {
    sel.value = NONE_OPT
    $('rowMirrorCustom').style.display = 'none'
  }
}

function refreshSettings() {
  return api('/config').then(function (c) {
    BUILTIN = c.builtinRepos || []
    MIRROR_PRESETS = c.mirrorPresets || []
    $('cfgProxy').value = c.proxy || ''
    refreshMirrorSelect(c.ghMirror || '')
    $('rowMirrorTest').style.display = 'none'
    $('cfgForceProxy').checked = !!c.forceProxy
    $('cfgDeep').checked = !!c.deepCheck
    $('cfgMaxDeep').value = c.maxDeepCheck || 60
    $('ghTokenState').textContent = c.ghTokenSet ? '已配置 ✓' : '未配置（未认证限额 60 次/小时）'
    renderRepos(c.customRepos || [])
  })
}
var builtinFolded = true
var lastCustom = []
function renderRepos(custom) {
  lastCustom = custom || []
  $('builtinRepos').innerHTML = BUILTIN.map(function (r) {
    return '<li><span class="lock">🔒</span><span class="grow">' + esc(r) + '</span><span class="muted">内置</span></li>'
  }).join('')
  $('builtinCnt').textContent = BUILTIN.length ? '（' + BUILTIN.length + ' 个，点击' + (builtinFolded ? '展开' : '收起') + '）' : ''
  var fold = $('btnFoldBuiltin')
  fold.classList.toggle('open', !builtinFolded)
  $('builtinRepos').classList.toggle('collapsed', builtinFolded)
  fold.onclick = function () {
    builtinFolded = !builtinFolded
    fold.classList.toggle('open', !builtinFolded)
    $('builtinRepos').classList.toggle('collapsed', builtinFolded)
    $('builtinCnt').textContent = BUILTIN.length ? '（' + BUILTIN.length + ' 个，点击' + (builtinFolded ? '展开' : '收起') + '）' : ''
  }
  $('customRepos').innerHTML = custom.length
    ? custom.map(function (r) {
      return '<li><span class="lock">👤</span><span class="grow">' + esc(r) + '</span>' +
        '<button class="small danger" data-repo="' + esc(r) + '">删除</button></li>'
    }).join('')
    : '<li class="grow-empty">暂无自定义仓库，用下方输入框添加</li>'
  var btns = $('customRepos').querySelectorAll('button[data-repo]')
  for (var i = 0; i < btns.length; i++) {
    btns[i].onclick = guard(function () {
      var repo = this.getAttribute('data-repo')
      if (!confirm('删除自定义仓库 ' + repo + '？（已收录的链接不受影响）')) return
      return api('/repos/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: repo }) })
        .then(function () { refreshSettings() })
    })
  }
}
onClick('btnSaveCfg', function () {
  var body = {
    proxy: $val('cfgProxy', ''),
    ghMirror: currentMirror(),
    forceProxy: $chk('cfgForceProxy'),
    deepCheck: $chk('cfgDeep'),
    maxDeepCheck: parseInt($val('cfgMaxDeep', '60'), 10) || 60
  }
  var tk = $val('cfgGhToken', '').trim()
  if (tk) body.ghToken = tk // 留空 = 保持原 Token 不变
  return api('/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function () { $('cfgGhToken').value = ''; return refreshSettings() }).then(function () { alert('设置已保存') })
})
onClick('btnAddRepo', function () {
  var raw = $('inpRepo').value.trim()
  if (!raw) { alert('请输入仓库，如 owner/repo'); return }
  // 与后端相同的归一化，便于本地预检
  var repo = raw.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '')
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(repo)) { alert('仓库格式无效，应为 owner/repo（如 guoyue2010/lxmusic-）'); return }
  for (var i = 0; i < BUILTIN.length; i++) {
    if (BUILTIN[i].toLowerCase() === repo.toLowerCase()) { alert('「' + repo + '」已在内置仓库中，无需添加'); return }
  }
  for (var j = 0; j < lastCustom.length; j++) {
    if (lastCustom[j].toLowerCase() === repo.toLowerCase()) { alert('「' + repo + '」已添加过，无需重复添加'); return }
  }
  return api('/repos/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: repo }) })
    .then(function () { $('inpRepo').value = ''; refreshSettings() })
    .catch(function (e) {
      var msg = e.message || String(e)
      if (/内置/.test(msg)) alert('「' + repo + '」已在内置仓库中，无需添加')
      else if (/已存在|已添加/.test(msg)) alert('「' + repo + '」已添加过，无需重复添加')
      else throw e
    })
})
bindEl('cfgMirrorSel', 'onchange', function () {
  $('rowMirrorCustom').style.display = this.value === CUSTOM_OPT ? '' : 'none'
  $('rowMirrorTest').style.display = 'none'
})

onClick('btnTestMirror', function () {
  var mirror = currentMirror()
  if (!mirror) { alert('请先选择或填写一个镜像（当前为"不使用镜像"）'); return }
  $('btnTestMirror').disabled = true
  var btn = $('btnTestMirror')
  var old = btn.textContent
  btn.textContent = '测试中…'
  $('rowMirrorTest').style.display = ''
  var res = $('mirrorTestResult')
  res.className = 'hint'
  res.textContent = '测试中…'
  return api('/test-mirror', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mirror: mirror }) })
    .then(function (r) {
      var best = null
      for (var i = 0; i < r.results.length; i++) {
        var x = r.results[i]
        if (x.ok && (!best || x.latencyMs < best.latencyMs)) best = x
      }
      if (best) { res.className = 'hint ok'; res.textContent = '可用 · ' + best.latencyMs + 'ms' }
      else { res.className = 'hint fail'; res.textContent = '不可用' }
    })
    .finally(function () { btn.disabled = false; btn.textContent = old })
})

bindEl('inpRepo', 'onkeydown', function (e) { if (e.key === 'Enter') $('btnAddRepo').onclick() })

/* ---------- 启动 ---------- */
refreshStats().then(refreshSources).catch(function (e) {
  $('rows').innerHTML = '<tr><td colspan="6" class="empty">加载失败: ' + esc(e.message) + '</td></tr>'
})
/* 页面在灌入中途刷新过：恢复按钮禁用与进度监听 */
api('/import-status').then(function (st) { if (st.running) watchImport() }).catch(function () {})
setInterval(pollJob, 1500)
pollJob()
