/**
 * The on-page annotation overlay (vanilla JS string, zero dependencies) —
 * served or injected by a carrier so any page can leave annotations against a
 * `page-feedback` store.
 *
 * Interaction: Alt+Click any element → a comment box floats at the cursor →
 * submit POSTs `{ comment, url, element, elementPath, cssClasses,
 * pathMatchCount, pathMatchesTarget, stableSelector?, columnHeader?, rowKey?,
 * reactKeyPath?, scroll?, viewport?, nearbyText, fieldName?, fieldLabel?,
 * fieldPlaceholder? }` to the carrier's `POST /api/feedback/annotations`
 * endpoint (origin-allowlisted there). The click target is taken from
 * `event.composedPath()` so a click inside a shadow subtree reports the real
 * inner element, and clicks on the overlay's own chrome are ignored.
 *
 * Positioning is deliberately stronger than a bare CSS dump, and the overlay
 * *self-verifies* what it emits: the heuristic path (sibling elements sharing
 * a tag+class fragment get a `:nth-child(n)` suffix so two same-class buttons
 * never collapse to one path — a real feedback loop learned this the hard way)
 * is re-resolved through the document before it is sent, escalating to an
 * all-`:nth-child(n)` form when the heuristic is ambiguous, and reporting the
 * verdict as `pathMatchCount` / `pathMatchesTarget` rather than letting a
 * consumer silently take the first match. Cross-boundary targets are encoded
 * with the shared marker protocol (` >>> ` shadow root, ` |> ` same-origin
 * iframe) whose prefix recurses back to the top document — a bare
 * `iframe.x > body > …` concat can never be resolved there, since CSS does not
 * cross frames. Attribute anchors (`stableSelector`), table row/column
 * semantics (`rowKey`/`columnHeader`), the React key chain (`reactKeyPath`),
 * and the scroll/viewport frame ride along for agent-side semantic location.
 *
 * Kept as a template-literal string so the package source stays DOM-free
 * (node:sqlite store package, no DOM lib); the JS is validated by text-level
 * tests rather than a DOM environment.
 * @module @deepseek-ai/dsh-page-feedback
 */

export const OVERLAY_JS = `(function () {
  if (window.__dshPageFeedback) return
  var BASE = document.currentScript && document.currentScript.src
    ? document.currentScript.src.replace(/\\/overlay\\.js.*$/, '').replace(/\\/feedback.*$/, '')
    : (window.__DSH_PAGE_FEEDBACK_BASE__ || 'http://' + (window.location.hostname || 'localhost') + ':14747')
  if (!BASE) { console.error('[page-feedback] base URL unknown'); return }
  window.__dshPageFeedback = true

  var style = document.createElement('style')
  style.textContent = [
    '.afb-hint{position:fixed;left:12px;bottom:12px;z-index:2147483646;background:#101724;color:#d7e0ea;border:1px solid #1e2a3a;border-radius:8px;padding:8px 12px;font:12px system-ui;box-shadow:0 2px 10px rgba(0,0,0,.4)}',
    '.afb-box{position:fixed;z-index:2147483647;background:#101724;color:#d7e0ea;border:1px solid #3ee6a8;border-radius:10px;padding:12px;font:13px system-ui;box-shadow:0 4px 20px rgba(0,0,0,.5);width:280px}',
    '.afb-box h4{margin:0 0 8px;font-size:12px;color:#3ee6a8;font-family:ui-monospace,monospace;word-break:break-all}',
    '.afb-box textarea{width:100%;height:64px;background:#070b11;color:#d7e0ea;border:1px solid #1e2a3a;border-radius:6px;padding:6px;font:12px system-ui;box-sizing:border-box}',
    '.afb-box .afb-row{margin-top:8px;text-align:right}',
    '.afb-box button{background:#3ee6a8;border:none;border-radius:6px;color:#06251a;font-weight:600;padding:5px 14px;font-size:12px;cursor:pointer;margin-left:6px}',
    '.afb-box button.ghost{background:none;border:1px solid #1e2a3a;color:#7d8ca0}',
    '.afb-meta{font-size:11px;color:#7d8ca0;margin-top:6px;word-break:break-all}',
    '.afb-toast{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#122019;color:#3ee6a8;border:1px solid #3ee6a8;border-radius:999px;padding:6px 16px;font:12px system-ui}'
  ].join('')
  document.head.appendChild(style)

  var hint = document.createElement('div')
  hint.className = 'afb-hint'
  hint.textContent = '批注模式：Alt+点击元素（Esc 退出）'
  document.body.appendChild(hint)
  setTimeout(function () { hint.remove() }, 8000)

  function fieldMeta(el) {
    var meta = {}
    var name = el.getAttribute && el.getAttribute('name')
    if (name) meta.fieldName = name
    var ph = el.getAttribute && el.getAttribute('placeholder')
    if (ph) meta.fieldPlaceholder = ph
    var label = null
    var id = el.getAttribute && el.getAttribute('id')
    if (id) { try { label = document.querySelector('label[for="' + CSS.escape(id) + '"]') } catch (e) { label = null } }
    if (!label && el.closest) label = el.closest('label')
    if (!label && el.closest) {
      var g = el.closest('[class*="group"],[class*="field"],.space-y-2')
      label = g ? g.querySelector('label') : null
    }
    if (label) {
      var t = (label.textContent || '').replace(/\\s+/g, ' ').trim().replace(/\\*$/, '').trim()
      if (t && t.length <= 30) meta.fieldLabel = t
    }
    return meta
  }

  function nearbyText(el) {
    var direct = Array.prototype.slice.call(el.childNodes)
      .filter(function (n) { return n.nodeType === 3 })
      .map(function (n) { return (n.textContent || '').replace(/\\s+/g, ' ').trim() })
      .filter(Boolean).join(' ')
    var text = direct
    if (!text) {
      text = Array.prototype.slice.call(el.children)
        .map(function (c) { return (c.textContent || '').replace(/\\s+/g, ' ').trim() })
        .filter(Boolean).slice(0, 5).join(' / ')
    }
    if (!text) return undefined
    return text.length > 80 ? text.slice(0, 80) + '…' : text
  }

  var BOUNDARY_SPLIT = /\\s*(?:>>>|\\|>)\\s*/
  var MAX_PATH_DEPTH = 64
  var MAX_ATTR_TEXT = 30
  var HAS_CSS_ESCAPE = typeof CSS !== 'undefined' && !!CSS.escape
  var STABLE_ATTRS = ['data-testid', 'data-test', 'data-qa']

  function attrLit(name, value) {
    return '[' + name + '=' + JSON.stringify(value) + ']'
  }

  function idSelector(tag, id) {
    return HAS_CSS_ESCAPE ? tag + '#' + CSS.escape(id) : tag + attrLit('id', id)
  }

  function classSelector(tag, classes) {
    if (HAS_CSS_ESCAPE) {
      return tag + classes.map(function (c) { return '.' + CSS.escape(c) }).join('')
    }
    return tag + classes.map(function (c) { return '[class~=' + JSON.stringify(c) + ']' }).join('')
  }

  function classFragment(el) {
    var out = []
    if (el.classList) {
      for (var i = 0; i < el.classList.length && out.length < 3; i += 1) out.push(el.classList.item(i))
      return out
    }
    var parts = (typeof el.className === 'string' ? el.className : '').replace(/\\s+/g, ' ').trim().split(' ')
    if (parts.length === 1 && !parts[0]) return out
    for (var j = 0; j < parts.length && out.length < 3; j += 1) out.push(parts[j])
    return out
  }

  // Same-fragment siblings collapse to one path — pin the index when any exist.
  function sameFragmentCount(el, classes) {
    if (!el.parentElement) return 0
    var want = classes.join('\\u0000')
    return Array.prototype.slice.call(el.parentElement.children).filter(function (s) {
      return s !== el && s.tagName === el.tagName && classFragment(s).join('\\u0000') === want
    }).length
  }

  function describe(el, forceIndex) {
    var tag = el.tagName.toLowerCase()
    if (el.id) return idSelector(tag, el.id)
    var classes = classFragment(el)
    var part = classSelector(tag, classes)
    var same = sameFragmentCount(el, classes)
    if (el.parentElement && (forceIndex || same > 0)) {
      var index = Array.prototype.slice.call(el.parentElement.children).indexOf(el) + 1
      part += ':nth-child(' + index + ')'
    }
    return part
  }

  function pathWithinRoot(el, forceIndex) {
    var parts = []
    var node = el
    while (node && node.nodeType === 1 && parts.length < MAX_PATH_DEPTH) {
      parts.unshift(describe(node, forceIndex))
      if (node.tagName === 'BODY') break
      node = node.parentElement
    }
    return parts.join(' > ')
  }

  // Boundary prefix (with trailing marker): shadow host via getRootNode().host,
  // same-origin frame via frameElement — recursing back to the top document.
  function boundaryPrefix(el, forceIndex) {
    var doc = el.ownerDocument
    if (doc !== document) {
      var frame = null
      try { frame = (doc.defaultView && doc.defaultView.frameElement) || null } catch (e) { frame = null }
      return frame ? scopedPath(frame, forceIndex) + ' |> ' : ''
    }
    var node = el
    while (node) {
      if (node.parentElement) { node = node.parentElement; continue }
      var root = node.getRootNode ? node.getRootNode() : null
      var host = root && root.host
      if (host) return scopedPath(host, forceIndex) + ' >>> '
      return ''
    }
    return ''
  }

  function scopedPath(el, forceIndex) {
    return boundaryPrefix(el, forceIndex) + pathWithinRoot(el, forceIndex)
  }

  // Boundary-aware resolution: every non-final hop (a shadow/iframe host) must
  // match exactly once, the final hop reports its total match count.
  function resolveInDocument(path) {
    var text = String(path)
    var hops = text.split(BOUNDARY_SPLIT)
    var kinds = []
    var mark
    var re = new RegExp(BOUNDARY_SPLIT.source, 'g')
    while ((mark = re.exec(text)) !== null) kinds.push(mark[0].indexOf('>>>') >= 0 ? 'shadow' : 'frame')
    var root = document
    for (var i = 0; i < hops.length; i += 1) {
      var selector = hops[i].trim()
      if (!root || !selector) return { element: null, matches: 0 }
      var matches
      try { matches = root.querySelectorAll(selector) } catch (e) { return { element: null, matches: 0 } }
      if (i === hops.length - 1) return { element: matches[0] || null, matches: matches.length }
      if (matches.length !== 1) return { element: null, matches: matches.length }
      if (kinds[i] === 'shadow') { root = matches[0].shadowRoot || null }
      else { try { root = matches[0].contentDocument || null } catch (e) { root = null } }
    }
    return { element: null, matches: 0 }
  }

  // Self-verified path: heuristic first, then all-nth-child, then an honest
  // "not unique" verdict (never a silent first-match).
  function resolveElementPath(el) {
    var heuristic = scopedPath(el, false)
    var first = resolveInDocument(heuristic)
    if (first.matches === 1 && first.element === el) return { path: heuristic, matchCount: 1, matchesTarget: true }
    var forced = scopedPath(el, true)
    var second = resolveInDocument(forced)
    if (second.matches === 1 && second.element === el) return { path: forced, matchCount: 1, matchesTarget: true }
    return second.matches > 0
      ? { path: forced, matchCount: second.matches, matchesTarget: false }
      : { path: heuristic, matchCount: first.matches, matchesTarget: false }
  }

  // Re-render-stable attribute anchor, verified unique inside the parsed scope.
  function stableSelector(el) {
    var prefix = boundaryPrefix(el, false)
    var tag = el.tagName.toLowerCase()
    var candidates = []
    for (var i = 0; i < STABLE_ATTRS.length; i += 1) {
      var value = el.getAttribute && el.getAttribute(STABLE_ATTRS[i])
      if (value) candidates.push(tag + attrLit(STABLE_ATTRS[i], value))
    }
    if (el.id) candidates.push(idSelector(tag, el.id))
    var name = el.getAttribute && el.getAttribute('name')
    if (name) candidates.push(tag + attrLit('name', name))
    var ariaLabel = el.getAttribute && el.getAttribute('aria-label')
    if (ariaLabel) candidates.push(tag + attrLit('aria-label', ariaLabel))
    for (var j = 0; j < candidates.length; j += 1) {
      var resolved = resolveInDocument(prefix + candidates[j])
      if (resolved.matches === 1 && resolved.element === el) return prefix + candidates[j]
    }
    return undefined
  }

  function collapsedText(node) {
    return node ? String(node.textContent || '').replace(/\\s+/g, ' ').trim() : ''
  }

  // Table semantics: column header by colSpan-accumulated column order, row key
  // from the row's first cell — disambiguates same-value cells/rows.
  function tableMeta(el) {
    var meta = {}
    var row = el.closest ? el.closest('tr') : null
    if (!row) return meta
    var head = collapsedText(row.querySelector('td, th'))
    if (head && head.length <= MAX_ATTR_TEXT) meta.rowKey = head
    if (el.tagName !== 'TD') return meta
    var index = 0
    var cells = Array.prototype.slice.call(row.children)
    for (var i = 0; i < cells.length; i += 1) {
      if (cells[i] === el) break
      index += cells[i].colSpan || 1
    }
    var table = el.closest ? el.closest('table') : null
    if (!table) return meta
    var firstRow = table.rows ? table.rows[0] : null
    var headRow = (table.tHead && table.tHead.rows[0]) || null
    if (!headRow && firstRow && firstRow !== row && firstRow.querySelector('th')) headRow = firstRow
    if (!headRow) return meta
    var acc = 0
    var headerCells = Array.prototype.slice.call(headRow.children)
    for (var j = 0; j < headerCells.length; j += 1) {
      if (acc === index) {
        var text = collapsedText(headerCells[j])
        if (text && text.length <= MAX_ATTR_TEXT) meta.columnHeader = text
        break
      }
      acc += headerCells[j].colSpan || 1
    }
    return meta
  }

  function reactFiberOf(el) {
    var keys
    try { keys = Object.keys(el) } catch (e) { return null }
    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i].indexOf('__reactFiber$') === 0) return el[keys[i]]
    }
    return null
  }

  // React identity chain (ComponentName#key, cap 8) — best-effort hint for
  // list/virtualized rows; absent without React fiber.
  function reactKeyPath(el) {
    var fiber = reactFiberOf(el)
    var out = []
    var lastName
    while (fiber && out.length < 8) {
      var type = fiber.type
      var name = typeof type === 'function' ? (type.displayName || type.name || undefined) : undefined
      if (name) lastName = name
      var key = fiber.key
      if (typeof key === 'string' || typeof key === 'number') {
        var label = (name || lastName || '?') + '#' + String(key)
        if (out.indexOf(label) < 0) out.push(label)
      }
      fiber = fiber.return || null
    }
    return out
  }

  function toast(text) {
    var t = document.createElement('div')
    t.className = 'afb-toast'
    t.textContent = text
    document.body.appendChild(t)
    setTimeout(function () { t.remove() }, 3000)
  }

  function showBox(target, x, y) {
    var old = document.querySelector('.afb-box')
    if (old) old.remove()
    var resolution = resolveElementPath(target)
    var path = resolution.path
    var meta = fieldMeta(target)
    var nearby = nearbyText(target)
    var anchors = stableSelector(target)
    var table = tableMeta(target)
    var keyPath = reactKeyPath(target)
    var box = document.createElement('div')
    box.className = 'afb-box'
    var title = document.createElement('h4')
    title.textContent = '批注 ' + (path.slice(0, 48) || '(页面)')
    var area = document.createElement('textarea')
    area.placeholder = '问题描述（如：按钮错位、文案不对）'
    var metaLine = document.createElement('div')
    metaLine.className = 'afb-meta'
    var bits = []
    if (meta.fieldLabel) bits.push('字段：' + meta.fieldLabel)
    if (meta.fieldName) bits.push('name=' + meta.fieldName)
    if (nearby) bits.push('附近：' + nearby.slice(0, 30))
    if (bits.length) metaLine.textContent = bits.join('  ')
    var row = document.createElement('div')
    row.className = 'afb-row'
    var cancel = document.createElement('button')
    cancel.className = 'ghost'
    cancel.textContent = '取消'
    var submit = document.createElement('button')
    submit.textContent = '提交批注'
    row.appendChild(cancel)
    row.appendChild(submit)
    box.appendChild(title)
    box.appendChild(area)
    if (bits.length) box.appendChild(metaLine)
    box.appendChild(row)
    box.style.left = Math.min(window.innerWidth - 300, x + 12) + 'px'
    box.style.top = Math.min(window.innerHeight - 220, y + 12) + 'px'
    document.body.appendChild(box)
    area.focus()

    cancel.onclick = function () { box.remove() }
    submit.onclick = function () {
      var comment = area.value.trim()
      if (!comment) { area.focus(); return }
      submit.disabled = true
      var payload = {
        url: window.location.href,
        comment: comment,
        element: target.tagName ? target.tagName.toLowerCase() : '',
        elementPath: path,
        cssClasses: (typeof target.className === 'string') ? target.className : '',
        pathMatchCount: resolution.matchCount,
        pathMatchesTarget: resolution.matchesTarget
      }
      if (anchors) payload.stableSelector = anchors
      if (table.columnHeader) payload.columnHeader = table.columnHeader
      if (table.rowKey) payload.rowKey = table.rowKey
      if (keyPath.length) payload.reactKeyPath = keyPath
      var ownWin = target.ownerDocument && target.ownerDocument.defaultView
      if (ownWin) {
        payload.scroll = { x: ownWin.scrollX || 0, y: ownWin.scrollY || 0 }
        payload.viewport = { width: ownWin.innerWidth, height: ownWin.innerHeight }
      }
      if (meta.fieldName) payload.fieldName = meta.fieldName
      if (meta.fieldLabel) payload.fieldLabel = meta.fieldLabel
      if (meta.fieldPlaceholder) payload.fieldPlaceholder = meta.fieldPlaceholder
      if (nearby) payload.nearbyText = nearby
      fetch(BASE + '/api/feedback/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) {
        box.remove()
        if (r.ok) toast('批注已提交'); else toast('提交失败 HTTP ' + r.status)
      }).catch(function () { box.remove(); toast('提交失败：server 不可达') })
    }
  }

  document.addEventListener('click', function (event) {
    if (!event.altKey) return
    // composedPath()[0] is the real inner element behind a shadow boundary;
    // event.target would be the retargeted host.
    var path0 = event.composedPath ? event.composedPath()[0] : event.target
    var target = (path0 && path0.nodeType === 1) ? path0 : event.target
    // Never annotate the overlay's own chrome (hint / comment box / toast).
    if (!target || !target.closest || target.closest('.afb-box,.afb-hint,.afb-toast')) return
    event.preventDefault()
    event.stopPropagation()
    showBox(target, event.clientX, event.clientY)
  }, true)
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      var old = document.querySelector('.afb-box')
      if (old) old.remove()
    }
  })
})()
`

/** Marker used by carriers to decide whether the overlay is already injected. */
export const OVERLAY_MARKER = '__dshPageFeedback'
