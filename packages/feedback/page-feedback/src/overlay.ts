/**
 * The on-page annotation overlay (vanilla JS string, zero dependencies) —
 * served or injected by a carrier so any page can leave annotations against a
 * `page-feedback` store.
 *
 * Interaction: Alt+Click any element → a comment box floats at the cursor →
 * submit POSTs `{ comment, url, element, elementPath, cssClasses, nearbyText,
 * fieldName?, fieldLabel?, fieldPlaceholder? }` to the carrier's
 * `POST /api/feedback/annotations` endpoint (origin-allowlisted there).
 *
 * Positioning is deliberately stronger than a bare CSS dump: sibling elements
 * sharing the same tag+class fragment get a `:nth-child(n)` suffix so two
 * same-class buttons never collapse to one path (the AliothStudio feedback
 * loop learned this the hard way), and nearby text / field metadata ride
 * along for agent-side semantic location.
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

  function cssPath(el) {
    if (!(el instanceof Element)) return ''
    var parts = []
    var node = el
    while (node && node.nodeType === 1 && parts.length < 12) {
      var tag = node.tagName.toLowerCase()
      var part = tag
      if (node.id) {
        var safeId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(node.id) : node.id
        part = tag + '#' + safeId
        parts.unshift(part)
        break
      }
      var classes = []
      if (node.className && typeof node.className === 'string') {
        classes = node.className.trim().split(/\\s+/).slice(0, 3)
        if (classes.length) part += '.' + classes.join('.')
      }
      // Same-fragment siblings collapse to one path — pin the index.
      var same = 0
      var index = 0
      if (node.parentElement) {
        var kids = Array.prototype.slice.call(node.parentElement.children)
        index = kids.indexOf(node) + 1
        same = kids.filter(function (s) {
          if (s === node) return false
          if (s.tagName !== node.tagName) return false
          var sc = (typeof s.className === 'string' ? s.className.trim().split(/\\s+/).slice(0, 3) : [])
          return sc.join('\\u0000') === classes.join('\\u0000')
        }).length
      }
      if (same > 0) part += ':nth-child(' + index + ')'
      parts.unshift(part)
      node = node.parentElement
    }
    return parts.join(' > ')
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
    var path = cssPath(target)
    var meta = fieldMeta(target)
    var nearby = nearbyText(target)
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
        cssClasses: (typeof target.className === 'string') ? target.className : ''
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
    event.preventDefault()
    event.stopPropagation()
    showBox(event.target, event.clientX, event.clientY)
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
