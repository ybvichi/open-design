/*!
 * Open Design · 通用 Mermaid 图查看器 (mermaid-viewer.js)
 * ------------------------------------------------------------------
 * 让文档站里所有由 Mermaid 渲染的图（flowchart / sequence / er / …）
 * 都支持「缩放 / 拖拽平移 / 触控捏合 / 双击复位」，并提供工具栏：
 *   − 缩小 · + 放大 · 100% 重置 · 适应窗口 · 缩放百分比
 *
 * 用法：在任意页面引入即可，无需额外 CSS（本工具自动注入样式）。
 *   <script src="js/mermaid-viewer.js"></script>
 *
 * 自动接管两类元素：
 *   1. .mermaid 容器 —— 等待 Mermaid 异步渲染出 <svg> 后自动包裹成查看器
 *      （支持 startOnLoad:true 的页面，platformization / tech-architecture 等）
 *   2. [data-mviewer] 容器 —— 显式声明：容器本身即查看器视口，
 *      其内第一个 <svg> 参与缩放（database-schema 的静态 ER 图等）
 *
 * 事件：滚轮缩放（以光标为中心）· 拖拽平移 · 双指捏合 · 双击复位
 * 行为与旧 ER 图查看器保持一致（MIN 0.05 / MAX 20，fit 不超过 100%）。
 */
(function () {
  'use strict';

  /* ── 注入工具自身样式（幂等，带 CSS 变量回退，适配深/浅主题）── */
  var VIEWER_CSS = '' +
    '.mviewer{position:relative;width:100%;height:72vh;min-height:460px;' +
    'overflow:hidden!important;touch-action:none;cursor:grab;user-select:none;' +
    'background:var(--card-bg,#fff);border:1px solid var(--border,#e2e6ea);' +
    'border-radius:10px;box-sizing:border-box}' +
    '.mviewer.dragging{cursor:grabbing}' +
    '.mviewer svg{-webkit-user-drag:none;user-select:none}' +
    '.mviewer-toolbar{position:absolute;top:12px;right:12px;z-index:10;' +
    'display:flex;align-items:center;gap:4px;background:var(--card-bg,#fff);' +
    'border:1px solid var(--border,#e2e6ea);border-radius:8px;padding:4px;' +
    'box-shadow:0 2px 8px rgba(0,0,0,.08)}' +
    '.mviewer-toolbar button{appearance:none;border:1px solid var(--border,#e2e6ea);' +
    'background:#fff;color:var(--text,#1f2328);border-radius:6px;min-width:30px;' +
    'height:30px;font-size:15px;line-height:1;cursor:pointer;padding:0 7px;' +
    'display:flex;align-items:center;justify-content:center}' +
    '.mviewer-toolbar button:hover{background:var(--accent-soft,#ddf4ff);' +
    'color:var(--accent,#0969da);border-color:var(--accent,#0969da)}' +
    '.mviewer-zoom{font-size:12px;color:var(--text-muted,#57606a);min-width:48px;' +
    'text-align:center;font-variant-numeric:tabular-nums;user-select:none}' +
    '.mviewer-hint{position:absolute;bottom:10px;left:14px;z-index:10;' +
    'font-size:12px;color:var(--text-muted,#57606a);pointer-events:none;' +
    'background:rgba(255,255,255,.75);padding:2px 9px;border-radius:6px}';

  if (!document.getElementById('mviewer-style')) {
    var style = document.createElement('style');
    style.id = 'mviewer-style';
    style.textContent = VIEWER_CSS;
    document.head.appendChild(style);
  }

  var MIN = 0.05;
  var MAX = 20;
  var initialized = new WeakSet();

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ── 把一个 svg 变成一个可缩放拖拽的查看器（viewport 为视口元素）── */
  function enableViewport(viewport, svg) {
    if (initialized.has(svg)) return;
    initialized.add(svg);

    var vb = svg.viewBox && svg.viewBox.baseVal;
    if (!vb || !vb.width || !vb.height) return;
    var NAT_W = vb.width;
    var NAT_H = vb.height;

    // 固定为自然尺寸，transform 才能按像素精确平移缩放
    svg.setAttribute('width', NAT_W);
    svg.setAttribute('height', NAT_H);
    svg.style.maxWidth = NAT_W + 'px';

    viewport.classList.add('mviewer');
    var scale = 1, tx = 0, ty = 0;
    var zoomLevel = document.createElement('span');
    zoomLevel.className = 'mviewer-zoom';

    function apply() {
      svg.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      svg.style.transformOrigin = '0 0';
      zoomLevel.textContent = Math.round(scale * 100) + '%';
    }
    function zoomAt(f, px, py) {
      var ns = clamp(scale * f, MIN, MAX);
      tx = px - (px - tx) * (ns / scale);
      ty = py - (py - ty) * (ns / scale);
      scale = ns;
      apply();
    }
    function centerView() {
      var cw = viewport.clientWidth, ch = viewport.clientHeight;
      if (!cw || !ch) return;
      tx = (cw - NAT_W * scale) / 2;
      ty = (ch - NAT_H * scale) / 2;
      apply();
    }
    function resetView() { scale = 1; centerView(); }
    function fitView() {
      var cw = viewport.clientWidth, ch = viewport.clientHeight;
      if (!cw || !ch) return;
      scale = clamp(Math.min(cw / NAT_W, ch / NAT_H), MIN, 1);
      centerView();
    }

    /* 工具栏 */
    var bar = document.createElement('div');
    bar.className = 'mviewer-toolbar';
    function mkBtn(html, title, fn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = html;
      b.title = title;
      b.addEventListener('click', fn);
      return b;
    }
    bar.appendChild(mkBtn('−', '缩小', function () {
      var cw = viewport.clientWidth, ch = viewport.clientHeight;
      zoomAt(1 / 1.25, cw / 2, ch / 2);
    }));
    bar.appendChild(mkBtn('+', '放大', function () {
      var cw = viewport.clientWidth, ch = viewport.clientHeight;
      zoomAt(1.25, cw / 2, ch / 2);
    }));
    bar.appendChild(mkBtn('100%', '重置缩放', resetView));
    bar.appendChild(mkBtn('适应', '适应窗口', fitView));
    bar.appendChild(zoomLevel);
    viewport.appendChild(bar);

    var hint = document.createElement('div');
    hint.className = 'mviewer-hint';
    hint.textContent = '拖拽平移 · 滚轮缩放 · 双击复位';
    viewport.appendChild(hint);

    /* 滚轮缩放（以光标位置为中心） */
    viewport.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = viewport.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    /* 指针拖拽 + 双指捏合 */
    var pointers = new Map();
    var isDrag = false;
    var sx, sy, stx, sty;
    var pinchDist = 0, pinchCX = 0, pinchCY = 0, pscale = 1, ptx = 0, pty = 0;

    viewport.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.mviewer-toolbar')) return;
      viewport.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        isDrag = true; sx = e.clientX; sy = e.clientY; stx = tx; sty = ty;
      } else if (pointers.size === 2) {
        isDrag = false;
        var a = [].concat.apply([], [].slice.call(pointers.values()));
        pinchDist = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        pinchCX = (a[0].x + a[1].x) / 2; pinchCY = (a[0].y + a[1].y) / 2;
        pscale = scale; ptx = tx; pty = ty;
      }
      viewport.classList.add('dragging');
      e.preventDefault();
    });

    viewport.addEventListener('pointermove', function (e) {
      var p = pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 1 && isDrag) {
        tx = stx + (e.clientX - sx);
        ty = sty + (e.clientY - sy);
        apply();
      } else if (pointers.size === 2) {
        var a = [].concat.apply([], [].slice.call(pointers.values()));
        var cxp = (a[0].x + a[1].x) / 2, cyp = (a[0].y + a[1].y) / 2;
        var d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (pinchDist > 0) {
          var ns = clamp(pscale * (d / pinchDist), MIN, MAX);
          var r = viewport.getBoundingClientRect();
          var vx = r.left + r.width / 2, vy = r.top + r.height / 2;
          tx = vx - (vx - ptx) * (ns / pscale) + (cxp - pinchCX);
          ty = vy - (vy - pty) * (ns / pscale) + (cyp - pinchCY);
          scale = ns;
          apply();
        }
      }
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        isDrag = false;
        viewport.classList.remove('dragging');
      }
      if (pointers.size < 2) pinchDist = 0;
    }
    viewport.addEventListener('pointerup', endPointer);
    viewport.addEventListener('pointercancel', endPointer);

    /* 双击复位 */
    viewport.addEventListener('dblclick', function (e) {
      if (e.target.closest('.mviewer-toolbar')) return;
      resetView();
    });

    fitView();
    window.addEventListener('resize', function () {
      if (scale <= 1.01) fitView();
    });
  }

  /* .mermaid 容器：等 mermaid 渲染出 svg 后，包裹成独立视口 */
  function initMermaid(el) {
    var svg = el.querySelector(':scope > svg');
    if (!svg) return;
    if (initialized.has(svg)) return;
    var vp = document.createElement('div');
    vp.className = 'mviewer';
    el.insertBefore(vp, svg);
    vp.appendChild(svg);
    enableViewport(vp, svg);
  }

  /* [data-mviewer] 容器：容器本身即视口，其内第一个 svg 参与 */
  function initOptIn(el) {
    var svg = el.querySelector('svg');
    if (!svg) return;
    enableViewport(el, svg);
  }

  function scan() {
    var m = document.querySelectorAll('.mermaid');
    for (var i = 0; i < m.length; i++) initMermaid(m[i]);
    var o = document.querySelectorAll('[data-mviewer]');
    for (var j = 0; j < o.length; j++) initOptIn(o[j]);
  }

  function scheduleScan() {
    if (scheduleScan.pending) return;
    scheduleScan.pending = true;
    requestAnimationFrame(function () {
      scheduleScan.pending = false;
      scan();
    });
  }

  /* ── 启动：立即扫一遍 + 监听 Mermaid 异步渲染 ── */
  function boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scan);
    } else {
      scan();
    }
    if (window.MutationObserver) {
      var mo = new MutationObserver(scheduleScan);
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
    window.addEventListener('load', scan);
  }

  boot();
})();
