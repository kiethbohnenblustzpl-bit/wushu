(function () {
  "use strict";

  var DATA = window.WUSHU_DATA;
  var ACTIONS = DATA.actions;
  var CATS = DATA.categories;
  var catMap = {};
  CATS.forEach(function (c) { catMap[c.id] = c; });

  var MIN_QUERY = 1;
  var SCORES = [10, 8, 6, 4];

  /* ---------- 工具 ---------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function norm(s) {
    return String(s || "").toLowerCase()
      .replace(/[\s\u3000,，。、；;：:·\-—_()（）【】\[\]"'’“”]/g, "");
  }

  function searchTerms(a) {
    var t = [norm(a.name), norm(a.shortName || "")];
    (a.alias || []).forEach(function (x) { t.push(norm(x)); });
    return t.filter(Boolean);
  }

  function textBlob(a) {
    if (!a._blob) {
      var parts = [a.name, a.shortName || "", (a.alias || []).join(" "), a.note || "", a.reps || ""];
      (a.levels || []).forEach(function (l) {
        parts.push(l.score + "分");
        l.points.forEach(function (p) { parts.push(p); });
      });
      if (a.deduct) {
        parts.push(a.deduct.rule || "");
        a.deduct.items.forEach(function (i) { parts.push(i); });
      }
      a._blob = norm(parts.join(" "));
    }
    return a._blob;
  }

  // 返回 {names:[...], bodies:[...]}
  function match(query) {
    var q = norm(query);
    if (q.length < MIN_QUERY) return { names: [], bodies: [] };
    var names = [], bodies = [];
    ACTIONS.forEach(function (a) {
      var hitName = searchTerms(a).some(function (t) { return t.indexOf(q) !== -1; });
      if (hitName) { names.push(a); return; }
      if (textBlob(a).indexOf(q) !== -1) bodies.push(a);
    });
    names.sort(function (a, b) {
      var an = norm(a.name), bn = norm(b.name);
      var as = an === q ? 0 : (an.indexOf(q) === 0 ? 1 : 2);
      var bs = bn === q ? 0 : (bn.indexOf(q) === 0 ? 1 : 2);
      return as - bs || an.length - bn.length;
    });
    return { names: names, bodies: bodies };
  }

  function hlt(text, query) {
    var raw = String(text == null ? "" : text);
    var q = String(query || "").trim();
    if (!q) return esc(raw);
    var out = "", lower = raw.toLowerCase(), lq = q.toLowerCase(), i = 0;
    while (i < raw.length) {
      var at = lower.indexOf(lq, i);
      if (at === -1) { out += esc(raw.slice(i)); break; }
      out += esc(raw.slice(i, at)) + "<mark class=\"hl\">" + esc(raw.slice(at, at + lq.length)) + "</mark>";
      i = at + lq.length;
    }
    return out;
  }

  function label(a) { return a.shortName || a.name; }

  /* ---------- 渲染 ---------- */

  function renderLevels(a, query) {
    if (!a.levels || !a.levels.length) {
      return '<div class="levels"><div class="level" style="grid-column:1/-1">' +
        '<p class="empty-note">原表未列出分档细则，仅计 ' + esc(a.score) + ' 分。</p></div></div>';
    }
    var html = '<div class="levels">';
    SCORES.forEach(function (s) {
      var lv = null;
      a.levels.forEach(function (x) { if (x.score === s) lv = x; });
      html += '<div class="level level-' + s + '">';
      html += '<span class="level-score">' + s + '分</span>';
      if (lv) {
        html += "<ul>";
        lv.points.forEach(function (p) { html += "<li>" + hlt(p, query) + "</li>"; });
        html += "</ul>";
      } else {
        html += '<p class="empty-note">—</p>';
      }
      html += "</div>";
    });
    return html + "</div>";
  }

  function renderDeduct(a, query) {
    if (!a.deduct || !a.deduct.items.length) return "";
    var html = '<div class="deduct"><div class="deduct-head"><h4>扣分内容</h4>';
    if (a.deduct.rule) html += '<span class="deduct-rule">' + esc(a.deduct.rule) + "</span>";
    html += '</div><ul>';
    a.deduct.items.forEach(function (i) { html += "<li>" + hlt(i, query) + "</li>"; });
    html += "</ul>";
    if (a.note) html += '<p class="action-note">备注：' + hlt(a.note, query) + "</p>";
    return html + "</div>";
  }

  function renderAction(a, query) {
    var cat = catMap[a.category];
    var html = '<article class="action" id="a-' + esc(a.name) + '">';
    html += '<header class="action-head"><div class="action-title">';
    html += "<h3>" + hlt(label(a), query) + "</h3>";
    html += '<span class="tag">' + esc(cat ? cat.name : "") + "</span>";
    html += '</div><div class="action-meta">';
    html += '<span class="badge badge-max">满分 ' + esc(a.score) + "</span>";
    if (a.reps) html += '<span class="badge badge-reps">' + esc(a.reps) + "</span>";
    html += "</div></header>";
    html += renderLevels(a, query);
    html += renderDeduct(a, query);
    if (a.note && (!a.deduct || !a.deduct.items.length)) {
      html += '<div class="deduct"><p class="action-note" style="margin-top:0;border-top:none;padding-top:0">备注：' +
        hlt(a.note, query) + "</p></div>";
    }
    return html + "</article>";
  }

  function renderOverview() {
    var m = DATA.meta;
    var html = '<div class="overview" id="overview"><h2>考核构成</h2><div class="bd-grid">';
    m.breakdown.forEach(function (b) {
      html += '<div class="bd-cell"><div class="bd-name">' + esc(b.name) + "</div>" +
        "<b>" + b.score + " 分</b>" +
        '<div class="bd-note">' + esc(b.note) + "</div></div>";
    });
    html += '</div><ul class="note-list">';
    m.notes.forEach(function (n) {
      html += '<li><span class="src">' + esc(n.source) + "</span><span>" + esc(n.text) + "</span></li>";
    });
    return html + "</ul></div>";
  }

  function renderGroup(cat, list, query) {
    var html = '<section class="group" id="g-' + esc(cat.id) + '">';
    html += '<div class="group-head"><h2>' + esc(cat.name) + "</h2>" +
      '<span class="group-meta">' + esc(cat.table) + " · " + esc(cat.desc) +
      " · 当前显示 " + list.length + " 项</span></div><div class=\"group-body\">";
    list.forEach(function (a) { html += renderAction(a, query); });
    return html + "</div></section>";
  }

  function emptyState(query) {
    var samples = ["正踢腿", "旋风脚", "侧手翻", "后扫腿", "腾空飞脚"];
    var html = '<div class="empty"><h3>没有找到匹配的动作规范</h3>' +
      "<p>试试动作名称的关键字，例如“踢腿”“°”“击响”，或点下面的动作名。</p>";
    html += '<div class="suggest-row">';
    samples.forEach(function (s) {
      html += '<button type="button" class="chip" data-jump="' + esc(s) + '">' + esc(s) + "</button>";
    });
    return html + "</div>";
  }

  /* ---------- 模式一：全部规范 ---------- */

  var filterInput = document.getElementById("filterInput");
  var filterClear = document.getElementById("filterClear");
  var allResults = document.getElementById("allResults");
  var chipBox = document.getElementById("categoryChips");
  var activeCat = "all";

  function buildChips() {
    var total = ACTIONS.length;
    var html = '<button type="button" class="chip is-active" data-cat="all">全部<span class="cnt">' + total + "</span></button>";
    CATS.forEach(function (c) {
      var n = ACTIONS.filter(function (a) { return a.category === c.id; }).length;
      html += '<button type="button" class="chip" data-cat="' + esc(c.id) + '">' + esc(c.name) +
        '<span class="cnt">' + n + "</span></button>";
    });
    chipBox.innerHTML = html;
  }

  function renderAll() {
    var q = filterInput.value.trim();
    var m = q ? match(q) : { names: ACTIONS, bodies: [] };
    var keep = q ? ACTIONS.filter(function (a) {
      return m.names.indexOf(a) !== -1 || m.bodies.indexOf(a) !== -1;
    }) : ACTIONS.slice();

    filterClear.hidden = !q;

    if (!keep.length) {
      allResults.innerHTML = emptyState(q);
      return;
    }

    var html = q ? "" : renderOverview();
    CATS.forEach(function (c) {
      if (activeCat !== "all" && activeCat !== c.id) return;
      var list = keep.filter(function (a) { return a.category === c.id; });
      if (list.length) html += renderGroup(c, list, q);
    });
    if (q) {
      html += '<div class="foot-note" style="font-size:12.5px;color:var(--ink-3)">筛选“' + esc(q) +
        "”，命中 " + keep.length + " 项。清空筛选可查看全部考纲。</div>";
    }
    allResults.innerHTML = html;
  }

  /* ---------- 模式二：按动作查询 ---------- */

  var queryInput = document.getElementById("queryInput");
  var queryClear = document.getElementById("queryClear");
  var lookupResult = document.getElementById("lookupResult");
  var lookupHint = document.getElementById("lookupHint");
  var activeQuery = "";

  function lookupPlaceholder() {
    var names = ACTIONS.slice(0, 6).map(function (a) { return label(a); });
    lookupHint.innerHTML = "可输入完整或部分名称，支持拼音首字母（如 <b>tkfj</b>、<b>xfj</b>）。共收录 <b>" +
      ACTIONS.length + "</b> 个考核动作。常用：" +
      names.map(function (n) { return '<b>' + esc(n) + "</b>"; }).join("、") + " 等。";
  }

  function renderLookup(query) {
    activeQuery = query;
    var q = query.trim();
    queryClear.hidden = !q;

    if (!q) {
      lookupResult.innerHTML = "";
      lookupPlaceholder();
      return;
    }

    var m = match(q);
    var html = "";

    if (m.names.length) {
      html += '<section class="group"><div class="group-head"><h2>动作规范</h2>' +
        '<span class="group-meta">' + m.names.length + " 个动作匹配“" + esc(q) + "”</span></div>" +
        '<div class="group-body">';
      m.names.forEach(function (a) { html += renderAction(a, q); });
      html += "</div></section>";
      lookupHint.innerHTML = '按动作名称匹配到 <b>' + m.names.length + "</b> 项。";
    } else if (m.bodies.length) {
      html += '<section class="group"><div class="group-head"><h2>标准正文匹配</h2>' +
        '<span class="group-meta">没有动作名称叫“' + esc(q) + '”，但以下 ' + m.bodies.length +
        " 项规范里提到了它</span></div><div class=\"group-body\">";
      m.bodies.forEach(function (a) { html += renderAction(a, q); });
      html += "</div></section>";
      lookupHint.innerHTML = '没有以“' + esc(q) + '”命名的动作，下面是正文命中的规范。';
    } else {
      html = emptyState(q);
      lookupHint.innerHTML = '没有找到“' + esc(q) + '”对应的动作规范。';
    }

    lookupResult.innerHTML = html;
  }

  /* ---------- 模式切换 ---------- */

  var tabAll = document.getElementById("tab-all");
  var tabLookup = document.getElementById("tab-lookup");
  var panelAll = document.getElementById("panel-all");
  var panelLookup = document.getElementById("panel-lookup");
  var tabVideo = document.getElementById("tab-video");
  var panelVideo = document.getElementById("panel-video");
  var MODES = [
    { id: "all", tab: tabAll, panel: panelAll },
    { id: "lookup", tab: tabLookup, panel: panelLookup },
    { id: "video", tab: tabVideo, panel: panelVideo }
  ];

  function setMode(mode, opts) {
    var known = MODES.some(function (m) { return m.id === mode; });
    if (!known) mode = "all";
    var leavingVideo = !panelVideo.hidden && mode !== "video";
    MODES.forEach(function (m) {
      var on = m.id === mode;
      m.tab.setAttribute("aria-selected", String(on));
      m.panel.hidden = !on;
    });
    if (leavingVideo && window.WUSHU_VIDEO_UI && window.WUSHU_VIDEO_UI.onLeave) {
      window.WUSHU_VIDEO_UI.onLeave();
    }
    if (mode === "all") {
      if (!opts || !opts.keepScroll) window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (mode === "lookup") {
      queryInput.focus({ preventScroll: true });
      if (!opts || !opts.keepScroll) queryInput.select();
    } else {
      if (!opts || !opts.keepScroll) window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  MODES.forEach(function (m) {
    m.tab.addEventListener("click", function () { setMode(m.id); });
  });

  /* ---------- 事件 ---------- */

  filterInput.addEventListener("input", renderAll);
  filterClear.addEventListener("click", function () { filterInput.value = ""; renderAll(); filterInput.focus(); });

  chipBox.addEventListener("click", function (e) {
    var btn = e.target.closest(".chip");
    if (!btn) return;
    activeCat = btn.getAttribute("data-cat");
    Array.prototype.forEach.call(chipBox.querySelectorAll(".chip"), function (c) {
      c.classList.toggle("is-active", c === btn);
    });
    renderAll();
    if (activeCat !== "all") {
      var g = document.getElementById("g-" + activeCat);
      if (g) g.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  queryInput.addEventListener("input", function () { renderLookup(queryInput.value); });
  queryClear.addEventListener("click", function () { queryInput.value = ""; renderLookup(""); queryInput.focus(); });
  queryInput.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { queryInput.value = ""; renderLookup(""); }
  });

  document.addEventListener("click", function (e) {
    var jump = e.target.closest("[data-jump]");
    if (!jump) return;
    setMode("lookup", { keepScroll: true });
    queryInput.value = jump.getAttribute("data-jump");
    renderLookup(queryInput.value);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== queryInput && document.activeElement !== filterInput) {
      e.preventDefault();
      if (!panelLookup.hidden) queryInput.focus();
      else if (panelVideo.hidden) { setMode("all"); filterInput.focus(); }
    }
  });

  document.getElementById("printBtn").addEventListener("click", function () { window.print(); });

  /* ---------- 深链接 ---------- */

  function fromHash() {
    var h = decodeURIComponent((location.hash || "").replace(/^#\/?/, ""));
    var m = h.match(/^(?:lookup|a)\/(.+)$/);
    if (m) {
      setMode("lookup", { keepScroll: true });
      queryInput.value = m[1];
      renderLookup(m[1]);
      return true;
    }
    return false;
  }

  window.addEventListener("hashchange", fromHash);

  /* ---------- 启动 ---------- */

  buildChips();
  renderAll();
  lookupPlaceholder();
  fromHash();
})();
