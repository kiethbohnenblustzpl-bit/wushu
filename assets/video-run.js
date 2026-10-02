/* 视频考核：骨架提取 + 指标计算 + 界面。
   依赖 assets/video.js（规则与算法）与 assets/pose/ 下的 MediaPipe 运行时。 */
(function () {
  "use strict";

  var V = window.WUSHU_VIDEO;
  var LM = V.LM;

  /* ---------- 运行时资源：先本地，失败再走 CDN ---------- */
  var SOURCES = [
    {
      label: "本地",
      bundle: "assets/pose/vision_bundle.mjs",
      wasm: "assets/pose",
      model: "assets/pose/pose_landmarker_full.task"
    },
    {
      label: "CDN",
      bundle: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs",
      wasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm",
      model: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"
    }
  ];

  // 相对路径要解析成完整 URL，否则动态 import 会当成裸模块名而失败
  function abspath(p) {
    if (/^https?:/i.test(p)) return p;
    try { return new URL(p, document.baseURI).href; } catch (e) { return p; }
  }

  var detector = null;
  var detectorLabel = "";

  async function loadDetector(status) {
    if (detector) return detector;
    var lastErr = null;
    for (var i = 0; i < SOURCES.length; i++) {
      var s = SOURCES[i];
      try {
        status("正在载入骨架模型（" + s.label + "）…");
        var bundleUrl = abspath(s.bundle);
        var wasmUrl = abspath(s.wasm);
        var modelUrl = abspath(s.model);
        var mod = await import(/* @vite-ignore */ bundleUrl);
        var PoseLandmarker = mod.PoseLandmarker || (mod.default && mod.default.PoseLandmarker);
        var FilesetResolver = mod.FilesetResolver || (mod.default && mod.default.FilesetResolver);
        if (!PoseLandmarker || !FilesetResolver) throw new Error("模块缺少 PoseLandmarker");
        var fileset = await FilesetResolver.forVisionTasks(wasmUrl);
        var opts = {
          baseOptions: { modelAssetPath: modelUrl, delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        };
        try {
          detector = await PoseLandmarker.createFromOptions(fileset, opts);
        } catch (gpuErr) {
          opts.baseOptions.delegate = "CPU";
          detector = await PoseLandmarker.createFromOptions(fileset, opts);
        }
        detectorLabel = s.label;
        return detector;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error("骨架模型载入失败：" + (lastErr && lastErr.message ? lastErr.message : lastErr) +
      "。若是离线打开，请改用完整文件夹版（需 assets/pose 目录），或保持联网。");
  }

  /* ---------- DOM ---------- */
  var el = {
    action: document.getElementById("vAction"),
    name: document.getElementById("vName"),
    file: document.getElementById("vFile"),
    pickFile: document.getElementById("vPickFile"),
    pickCam: document.getElementById("vPickCam"),
    speed: document.getElementById("vSpeed"),
    hint: document.getElementById("vHint"),
    stage: document.getElementById("vStage"),
    video: document.getElementById("vVideo"),
    canvas: document.getElementById("vCanvas"),
    overlay: document.getElementById("vOverlay"),
    actions: document.getElementById("vActions"),
    start: document.getElementById("vStart"),
    replay: document.getElementById("vReplay"),
    record: document.getElementById("vRecord"),
    calib: document.getElementById("vCalib"),
    status: document.getElementById("vStatus"),
    results: document.getElementById("vResults"),
    records: document.getElementById("vRecords"),
    calibInfo: document.getElementById("vCalibInfo")
  };
  if (!el.action) return;

  var ctx = el.canvas.getContext("2d");
  var state = {
    src: null,          // 'file' | 'camera'
    stream: null,
    frames: [],
    analysis: null,
    result: null,
    running: false,
    camTimer: null
  };

  var CALIB_KEY = "wushu.video.calib.v1";
  function loadCalib() {
    try { return JSON.parse(localStorage.getItem(CALIB_KEY) || "{}"); } catch (e) { return {}; }
  }
  function saveCalib(obj) {
    try { localStorage.setItem(CALIB_KEY, JSON.stringify(obj)); } catch (e) { /* 忽略 */ }
  }
  var calibStore = loadCalib();

  /* ---------- 动作下拉 ---------- */
  var CAT_NAME = { leg: "腿法", jump: "跳跃", routine: "套路演练", daily: "平时分" };
  function buildActionOptions() {
    var groups = { leg: [], jump: [], routine: [], daily: [] };
    (window.WUSHU_DATA.actions || []).forEach(function (a) {
      var key = a.shortName || a.name;
      (groups[a.category] = groups[a.category] || []).push(key);
    });
    var html = "";
    Object.keys(groups).forEach(function (g) {
      html += '<optgroup label="' + (CAT_NAME[g] || g) + '">';
      groups[g].forEach(function (n) {
        var measurable = !!V.RULES[n];
        html += '<option value="' + n + '"' + (measurable ? "" : " data-manual=\"1\"") + ">" + n +
          (measurable ? "" : "（暂不自动评分）") + "</option>";
      });
      html += "</optgroup>";
    });
    el.action.innerHTML = html;
    el.action.value = "正踢腿";
  }

  function currentRule() { return V.RULES[el.action.value] || null; }

  /* ---------- 绘制 ---------- */
  function mid2(a, b) { return [(a.x + b.x) / 2, (a.y + b.y) / 2]; }
  function imgLineY(lm, hVal) {
    var hip = mid2(lm[LM.hipL], lm[LM.hipR]);
    var sh = mid2(lm[LM.shL], lm[LM.shR]);
    var vx = sh[0] - hip[0], vy = sh[1] - hip[1];
    var L = Math.hypot(vx, vy) || 1e-6;
    return hip[1] + hVal * L * (vy / L);
  }

  var LINE_STYLE = [
    { key: "headTop", label: "头顶线", color: "#0f7a5f" },
    { key: "forehead", label: "额头线", color: "#12688a" },
    { key: "chin", label: "下巴线", color: "#9c5a06" },
    { key: "shoulder", label: "肩线", color: "#c0392b" }
  ];

  function draw(res, showLines) {
    var vw = el.video.videoWidth || 640, vh = el.video.videoHeight || 480;
    if (el.canvas.width !== vw) { el.canvas.width = vw; el.canvas.height = vh; }
    ctx.clearRect(0, 0, vw, vh);
    ctx.drawImage(el.video, 0, 0, vw, vh);
    var lm = res && res.landmarks && res.landmarks[0];
    if (!lm) return;

    // 参考线
    if (showLines) {
      var f = V.frameFeatures({ image: lm, world: res.worldLandmarks && res.worldLandmarks[0], t: 0 });
      if (f) {
        LINE_STYLE.forEach(function (s) {
          var y = imgLineY(lm, f.lines[s.key]) * vh;
          if (!isFinite(y) || y < 0 || y > vh) return;
          ctx.save();
          ctx.strokeStyle = s.color;
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = Math.max(1.5, vw / 640);
          ctx.setLineDash([10, 6]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(vw, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = "600 " + Math.max(13, vw / 45) + "px system-ui, sans-serif";
          var tw = ctx.measureText(s.label).width;
          ctx.globalAlpha = 0.92;
          ctx.fillStyle = s.color;
          ctx.fillRect(8, y - 22, tw + 14, 22);
          ctx.fillStyle = "#fff";
          ctx.fillText(s.label, 15, y - 6);
          ctx.restore();
        });
      }
    }

    // 骨架
    var w = vw, h = vh;
    ctx.lineWidth = Math.max(2, vw / 400);
    ctx.strokeStyle = "rgba(23,26,32,.55)";
    ctx.beginPath();
    V.SKELETON.forEach(function (p) {
      var a = lm[p[0]], b = lm[p[1]];
      if (!a || !b) return;
      if ((a.visibility || 1) < 0.3 || (b.visibility || 1) < 0.3) return;
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
    });
    ctx.stroke();
    ctx.fillStyle = "#c0392b";
    [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].forEach(function (i) {
      var p = lm[i];
      if (!p || (p.visibility || 1) < 0.3) return;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, Math.max(2.5, vw / 260), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /* ---------- 分析主循环 ---------- */
  function setStatus(s) { el.status.textContent = s || ""; }

  function finishRun() {
    state.running = false;
    if (state.camTimer) { clearTimeout(state.camTimer); state.camTimer = null; }
    if (state.src === "camera" && state.stream) {
      state.stream.getTracks().forEach(function (t) { t.stop(); });
      el.video.srcObject = null;
    }
    el.start.disabled = false;
    el.start.textContent = "重新分析";

    var A = V.analyzeSequence(state.frames);
    state.analysis = A;
    if (!A.ok) {
      setStatus("");
      el.results.innerHTML = '<div class="empty"><h3>没能完成分析</h3><p>' + A.reason + "</p></div>";
      return;
    }
    var rule = currentRule();
    if (!rule) {
      setStatus("");
      el.results.innerHTML = '<div class="empty"><h3>该考核项暂不支持自动评分</h3>' +
        "<p>套路演练、平时分这类项目需要人工评定。可改选腿法或跳跃类动作。</p></div>";
      state.result = null;
      return;
    }
    var R = V.evaluate(el.action.value, A, calibStore[el.action.value]);
    state.result = R;
    setStatus("分析完成，共 " + state.frames.length + " 帧 · 模型来源：" + detectorLabel);
    renderResult(R, A);
  }

  async function run() {
    if (state.running) return;
    if (!state.src) { setStatus("请先选择视频文件或打开摄像头。"); return; }
    if (!currentRule()) { setStatus("该考核项暂不支持自动评分。"); return; }

    el.start.disabled = true;

    try {
      await loadDetector(setStatus);
    } catch (e) {
      el.start.disabled = false;
      setStatus(e.message);
      return;
    }

    state.frames = [];
    state.analysis = null;
    state.result = null;
    el.results.innerHTML = "";
    state.running = true;
    setStatus("分析中…");

    if (state.src === "file") {
      await runOnFile();
    } else {
      await runOnCamera();
    }
    if (state.running) finishRun();
  }

  // 逐帧定位取样：与播放速度解耦，短片也不会"还没采够就播完"
  function seekTo(t) {
    return new Promise(function (resolve) {
      var v = el.video;
      if (Math.abs(v.currentTime - t) < 0.002) { resolve(); return; }
      var done = false;
      function ok() {
        if (done) return;
        done = true;
        v.removeEventListener("seeked", ok);
        resolve();
      }
      v.addEventListener("seeked", ok);
      try { v.currentTime = t; } catch (e) { ok(); return; }
      setTimeout(ok, 2500);
    });
  }

  function grab(res, t) {
    draw(res, true);
    if (res && res.landmarks && res.landmarks[0]) {
      state.frames.push({
        t: t,
        image: res.landmarks[0],
        world: res.worldLandmarks && res.worldLandmarks[0]
      });
    }
  }

  async function runOnFile() {
    var dur = el.video.duration;
    if (!isFinite(dur) || dur <= 0) { await runOnCamera(); return; }
    if (el.speed.value === "fine") { await runFileFine(dur); return; }

    await runFileFast();
    // 快速采样在慢设备上可能丢帧，帧数明显偏少时自动改用逐帧精析
    var need = Math.min(80, Math.max(8, dur * 6));
    if (state.running && state.frames.length < need) {
      state.frames = [];
      setStatus("快速采样帧数偏少（" + state.frames.length + "），自动改用逐帧精析…");
      await runFileFine(dur);
    }
  }

  async function runFileFast() {
    el.video.playbackRate = 1;
    el.video.currentTime = 0;
    await el.video.play();
    var lastT = -1;
    await new Promise(function (resolve) {
      function step() {
        if (!state.running) { resolve(); return; }
        requestAnimationFrame(step);
        if (!el.video.videoWidth) return;
        if (el.video.paused || el.video.ended) { resolve(); return; }
        if (el.video.currentTime === lastT) return;
        lastT = el.video.currentTime;
        var res = null;
        try { res = detector.detectForVideo(el.video, performance.now()); } catch (e) { /* 跳过 */ }
        grab(res, lastT);
        if (el.video.duration) {
          setStatus("分析中（快速）… " + Math.round((lastT / el.video.duration) * 100) +
            "%（已采集 " + state.frames.length + " 帧）");
        }
      }
      step();
    });
  }

  async function runFileFine(dur) {
    var sampleFps = 30;
    var step = 1 / sampleFps;
    var total = Math.max(1, Math.floor(dur / step));
    el.video.pause();
    for (var i = 0; i <= total; i++) {
      if (!state.running) return;
      var t = Math.min(dur - 0.001, i * step);
      await seekTo(t);
      var res = null;
      try { res = detector.detectForVideo(el.video, i * step * 1000 + 1); } catch (e) { /* 跳过单帧 */ }
      grab(res, t);
      if (i % 6 === 0 || i === total) {
        setStatus("分析中（精析）… " + Math.round((i / total) * 100) + "%（已采集 " + state.frames.length + " 帧）");
        await new Promise(function (r) { setTimeout(r, 0); });
      }
    }
  }

  async function runOnCamera() {
    el.video.playbackRate = parseFloat(el.speed.value) || 1;
    await el.video.play();
    setStatus("实时分析中…再做 8 秒后自动结束");
    state.camTimer = setTimeout(finishRun, 8000);
    var lastTs = 0;
    await new Promise(function (resolve) {
      function step() {
        if (!state.running) { resolve(); return; }
        requestAnimationFrame(step);
        if (!el.video.videoWidth) return;
        var ts = performance.now();
        if (ts <= lastTs) return;
        lastTs = ts;
        var res = null;
        try { res = detector.detectForVideo(el.video, ts); } catch (e) { /* 跳过 */ }
        grab(res, el.video.currentTime);
        setStatus("实时分析中…已采集 " + state.frames.length + " 帧");
      }
      step();
    });
  }

  /* ---------- 结果呈现 ---------- */
  function bandName(score) { return score + " 分"; }
  function fmt(v, d) { return (v == null || !isFinite(v)) ? "—" : v.toFixed(d == null ? 2 : d); }

  function renderResult(R, A) {
    var p = A.peak;
    var rule = currentRule();
    var html = "";
    var cls = R.score >= 9 ? "s10" : R.score >= 7 ? "s8" : R.score >= 5 ? "s6" : "s4";

    html += '<div class="vscore v-' + cls + '">';
    html += '<div class="vscore-num">' + R.score + "<span>分</span></div>";
    html += "<div>";
    html += "<h3>" + esc(R.action) + " · 判定档位 <b>" + bandName(R.base) + "</b></h3>";
    html += '<p class="vscore-text">' + esc(R.text) + "</p>";
    html += '<p class="vscore-calc">' + R.base + "（档位）" +
      (R.deduct ? " − " + R.deduct + "（扣分" + (R.ruleText ? "：" + esc(R.ruleText) : "") + "）" : " − 0（无扣分）") +
      " = <b>" + R.score + " 分</b></p>";
    html += "</div></div>";

    // 关键指标：只显示与该动作判据相关的量，避免无关数字干扰阅读
    var kind = rule.kind;
    var needHeight = kind === "legHeight" || kind === "split" || kind === "kickInAir";
    var needRot = kind === "rotation" || kind === "jumpRotation";
    var needJump = kind === "jumpHeight" || kind === "jumpRotation";
    var needSweep = el.action.value === "里合腿" || el.action.value === "外摆腿" || kind === "rotation";
    var lineRows = [];
    if (needHeight && p) {
      lineRows.push(["脚跟最高点", fmt(p.heel, 2), "躯干倍数（髋=0，肩=1）"]);
      lineRows.push(["脚尖最高点", fmt(p.toe, 2), "躯干倍数"]);
      lineRows.push(["头顶线 / 额头线", fmt(p.lines.headTop, 2) + " / " + fmt(p.lines.forehead, 2), "文档判据线"]);
      lineRows.push(["下巴线 / 肩线", fmt(p.lines.chin, 2) + " / " + fmt(p.lines.shoulder, 2), "文档判据线"]);
      lineRows.push(["踢击腿膝盖角", fmt(p.kickKnee, 1) + "°", "≥" + effQ("kickKneeMin") + "° 视为伸直"]);
      lineRows.push(["支撑腿膝盖角", fmt(p.supKnee, 1) + "°", "踢到最高点时；≥" + effQ("supKneeMin") + "° 为伸直"]);
    }
    if (kind === "split" && p) {
      lineRows.push(["两腿幅度", fmt(p.split, 1) + "°", "文档要求 >135°"]);
    }
    if (needSweep && p) {
      lineRows.push(["抡腿幅度", fmt(p.sweep, 0) + "°", "≥" + effQ("sweepGood") + "° 算明显"]);
    }
    if (needHeight && p) {
      lineRows.push(["起腿速度", fmt(p.burst, 2), "爆发力的代理指标，越大越快"]);
    }
    if (needRot) {
      lineRows.push(["身体旋转总量", fmt(A.rotTotal, 0) + "°", "档位判据，见下方分档依据"]);
    }
    if (needJump) {
      lineRows.push(["腾空高度", fmt(A.jumpHeight, 2), "躯干倍数，站立时为 0"]);
      lineRows.push(["腾空时长占比", fmt(A.flightRatio * 100, 0) + "%", "双脚离地帧占全片比例"]);
    }
    if (kind === "inversion") {
      lineRows.push(["倒立时长占比", fmt((A.invertedRatio || 0) * 100, 0) + "%", "头低于髋的帧占比"]);
      lineRows.push(["转体角速度峰值", fmt(A.maxYawVelocity, 0) + "°/秒", "翻得是否干脆"]);
    }
    var hasWobble = rule.deductions.some(function (d) { return d.id === "wobble"; });
    if (p && hasWobble) {
      lineRows.push(["支撑脚晃动", fmt(p.jitter, 3) + " 米", "≤" + effQ("jitterMax") + " 米算稳定"]);
    }
    lineRows.push(["节奏离散度", fmt(A.intervalCv, 2), "≤" + effQ("tempoCvMax") + " 算均匀"]);
    lineRows.push(["采样帧数 / 时长", A.frames.length + " 帧 / " + fmt(A.duration, 1) + " 秒", "逐帧精度取决于该数值"]);

    html += '<div class="vpanel"><h3>实测指标</h3><div class="vtable">';
    lineRows.forEach(function (r) {
      html += '<div class="vtr"><span class="vtk">' + esc(r[0]) + '</span><b class="vtv">' + esc(r[1]) +
        '</b><span class="vtn">' + esc(r[2]) + "</span></div>";
    });
    html += "</div></div>";

    // 分档判据逐条比对
    html += '<div class="vpanel"><h3>分档依据（来自文档原文）</h3><ul class="vlevels">';
    rule.levels.forEach(function (L, i) {
      var reach = false;
      if (p && rule.kind === "legHeight") reach = p[L.point] >= p.lines[L.line];
      if (p && rule.kind === "split") reach = (p[L.point] >= p.lines[L.line]) && (p.split > L.split);
      if (rule.kind === "rotation" || rule.kind === "jumpRotation") reach = A.rotTotal >= L.rot;
      var isHit = R.base === L.score;
      html += '<li class="' + (isHit ? "is-hit" : "") + (reach ? " is-reach" : "") + '">' +
        '<span class="vl-score">' + L.score + "分</span>" +
        '<span class="vl-text">' + esc(L.text) + "</span>" +
        '<span class="vl-flag">' + (isHit ? "本次判定档位" : reach ? "几何上已达到" : "未达到") + "</span></li>";
    });
    html += '<li class="vl-fallback' + (R.base === rule.fallback.score ? " is-hit" : "") + '">' +
      '<span class="vl-score">' + rule.fallback.score + "分</span>" +
      '<span class="vl-text">' + esc(rule.fallback.text) + "</span></li>";
    html += "</ul></div>";

    // 扣分项
    html += '<div class="vpanel"><h3>扣分项自动比对</h3><ul class="vchecks">';
    R.checks.forEach(function (c) {
      var tag = c.status === "fail" ? "判定扣分" : c.status === "manual" ? "需人工确认" :
        (c.status === "pass-low" ? "自动判定通过（把握较低）" : "通过");
      html += '<li class="vc-' + c.status + '"><span class="vc-label">' + esc(c.label) + "</span>" +
        '<span class="vc-detail">' + esc(c.detail) + "</span>" +
        '<span class="vc-tag">' + tag + "</span></li>";
    });
    html += "</ul></div>";

    // 次数
    var rep = R.repRule;
    var balance = rep.balance ? ("（左 " + A.countL + " 次 / 右 " + A.countR + " 次") : "";
    html += '<div class="vpanel"><h3>次数与节奏</h3>' +
      '<p class="vreps">文档要求 <b>' + esc(rep.note) + "</b>；本次检测到 <b>" + A.repCount + " 次</b>" + esc(balance) +
      (A.repCount && rep.required && A.repCount < rep.required
        ? '。<span class="vwarn">少于要求次数，需补足。</span>'
        : "。") + "</p></div>";

    // 与标定示范对比
    var cal = calibStore[R.action];
    if (cal && cal.ref && p) {
      html += '<div class="vpanel"><h3>与标定示范的对比</h3><div class="vtable">';
      var rows = [
        ["脚跟最高点", fmt(p.heel, 2), fmt(cal.ref.heel, 2)],
        ["两腿幅度", fmt(p.split, 1) + "°", fmt(cal.ref.split, 1) + "°"],
        ["支撑腿膝盖角", fmt(p.supKnee, 1) + "°", fmt(cal.ref.supKnee, 1) + "°"],
        ["抡腿幅度", fmt(p.sweep, 0) + "°", fmt(cal.ref.sweep, 0) + "°"]
      ];
      rows.forEach(function (r) {
        html += '<div class="vtr"><span class="vtk">' + esc(r[0]) + '</span><b class="vtv">' + esc(r[1]) +
          '</b><span class="vtn">示范：' + esc(r[2]) + "</span></div>";
      });
      html += "</div></div>";
    }

    html += '<p class="vdisclaimer">自动判定基于单目骨架估计，同一动作不同机位会带来误差。' +
      "标注“需人工确认”的项（如掌型、击响、落地位移）无法从骨架判断，请由教练复核。标定质量阈值后判定会更贴合本队标准。</p>";

    el.results.innerHTML = html;
    el.calib.hidden = !currentRule();
    el.record.hidden = false;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function effQ(key) {
    var cal = calibStore[el.action.value];
    var v = (cal && cal.quality && cal.quality[key] != null) ? cal.quality[key] : V.QUALITY_DEFAULTS[key];
    return typeof v === "number" ? Math.round(v * 100) / 100 : v;
  }

  /* ---------- 标定 ---------- */
  function renderCalibInfo() {
    var keys = Object.keys(calibStore);
    var html = '<div class="vpanel vcalib"><h3>标定档案</h3>';
    if (!keys.length) {
      html += '<p class="vhint">还没有标定。做法：让教练录一段该动作的满分示范，' +
        "选择动作 → 导入示范视频 → 开始分析 → 点“把这次结果设为该动作的 10 分参考”。</p>";
    } else {
      html += '<p class="vhint">已标定 ' + keys.length + " 个动作。阈值可在下方微调，改动立即生效。</p>";
      html += '<ul class="vcalib-list">';
      keys.forEach(function (k) {
        var c = calibStore[k];
        html += "<li><b>" + esc(k) + "</b><span>" + esc(c.savedAt || "") + "</span>" +
          '<button type="button" class="mini-btn" data-calib-edit="' + esc(k) + '">微调阈值</button>' +
          '<button type="button" class="mini-btn" data-calib-del="' + esc(k) + '">删除</button></li>';
      });
      html += "</ul>";
    }
    html += '<div class="vrow-btn">' +
      '<button type="button" class="mini-btn" id="vCalibExport">导出标定文件</button>' +
      '<button type="button" class="mini-btn" id="vCalibImport">导入标定文件</button>' +
      '<input type="file" id="vCalibFile" accept=".json,application/json" hidden />' +
      "</div>" +
      '<p class="vhint">标定存在本浏览器里。要换电脑、换浏览器或在几位教练之间共用，请导出成文件传递。</p>';
    html += "</div>";
    el.calibInfo.innerHTML = html;
    document.getElementById("vCalibExport").addEventListener("click", function () {
      if (!Object.keys(calibStore).length) { setStatus("还没有标定数据可导出。"); return; }
      downloadFile("武术考核标定_" + stamp() + ".json",
        JSON.stringify({ type: "wushu-video-calibration", version: 1, savedAt: new Date().toISOString(), data: calibStore }, null, 2));
      setStatus("标定文件已导出。");
    });
    var cFile = document.getElementById("vCalibFile");
    document.getElementById("vCalibImport").addEventListener("click", function () { cFile.click(); });
    cFile.addEventListener("change", function () {
      var f = cFile.files && cFile.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var obj = JSON.parse(String(rd.result));
          var payload = obj && obj.data ? obj.data : obj;
          if (!payload || typeof payload !== "object") throw new Error("格式不正确");
          Object.keys(payload).forEach(function (k) { calibStore[k] = payload[k]; });
          saveCalib(calibStore);
          calibStore = loadCalib();
          renderCalibInfo();
          if (state.result) renderResult(state.result, state.analysis);
          setStatus("已导入标定：" + Object.keys(payload).join("、"));
        } catch (e) {
          setStatus("导入失败：" + e.message);
        }
        cFile.value = "";
      };
      rd.readAsText(f);
    });
  }

  /* ---------- 成绩表 ---------- */
  var RECORD_KEY = "wushu.video.records.v1";
  function loadRecords() {
    try { return JSON.parse(localStorage.getItem(RECORD_KEY) || "[]"); } catch (e) { return []; }
  }
  function saveRecords(list) {
    try { localStorage.setItem(RECORD_KEY, JSON.stringify(list)); } catch (e) { /* 忽略 */ }
  }
  var records = loadRecords();

  function stamp(d) {
    var t = d || new Date();
    function p(n) { return String(n).padStart(2, "0"); }
    return t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()) + "_" + p(t.getHours()) + p(t.getMinutes());
  }

  function downloadFile(name, text) {
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }

  function recordsToCsv() {
    var head = ["姓名/学号", "动作", "档位分", "扣分", "最终得分", "检测次数", "左/右",
      "脚跟最高点", "支撑腿膝盖角", "踢击腿膝盖角", "抡腿幅度", "转体总量", "需人工确认项", "记录时间"];
    var rows = [head.join(",")];
    records.forEach(function (r) {
      rows.push([
        r.name, r.action, r.base, r.deduct, r.score, r.repCount, (r.countL || 0) + "/" + (r.countR || 0),
        r.heel == null ? "" : r.heel, r.supKnee == null ? "" : r.supKnee, r.kickKnee == null ? "" : r.kickKnee,
        r.sweep == null ? "" : r.sweep, r.rotTotal == null ? "" : r.rotTotal, r.manual || 0, r.time
      ].map(function (v) {
        var s = String(v == null ? "" : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(","));
    });
    return "\uFEFF" + rows.join("\r\n");
  }

  function renderRecords() {
    if (!records.length) {
      el.records.innerHTML = '<div class="vpanel vcalib"><h3>成绩表</h3>' +
        '<p class="vhint">分析完成后点“记入成绩表”，成绩会累积在这里，可导出成 Excel 能直接打开的 CSV。</p></div>';
      return;
    }
    var html = '<div class="vpanel"><h3>成绩表 · 共 ' + records.length + " 条</h3>" +
      '<div class="vtable vtable-rec"><div class="vtr vtr-head">' +
      "<span>姓名</span><span>动作</span><span>档位</span><span>扣分</span><span>得分</span><span>次数</span><span>时间</span><span></span>" +
      "</div>";
    records.forEach(function (r, i) {
      html += '<div class="vtr"><span class="vtk">' + esc(r.name || "—") + "</span>" +
        "<span>" + esc(r.action) + "</span>" +
        "<span>" + esc(r.base) + "</span>" +
        "<span>" + esc(r.deduct) + "</span>" +
        '<b class="vtv">' + esc(r.score) + "</b>" +
        "<span>" + esc(r.repCount) + "</span>" +
        '<span class="vtn">' + esc(r.time) + "</span>" +
        '<span><button type="button" class="mini-btn" data-rec-del="' + i + '">删除</button></span></div>';
    });
    html += "</div><div class=\"vrow-btn\">" +
      '<button type="button" class="btn" id="vRecCsv">导出 CSV（Excel 可直接打开）</button>' +
      '<button type="button" class="btn" id="vRecJson">导出 JSON</button>' +
      '<button type="button" class="mini-btn" id="vRecClear">清空成绩表</button>' +
      "</div></div>";
    el.records.innerHTML = html;
    document.getElementById("vRecCsv").addEventListener("click", function () {
      downloadFile("武术考核成绩_" + stamp() + ".csv", recordsToCsv());
      setStatus("成绩表已导出为 CSV。");
    });
    document.getElementById("vRecJson").addEventListener("click", function () {
      downloadFile("武术考核成绩_" + stamp() + ".json",
        JSON.stringify({ type: "wushu-video-records", version: 1, data: records }, null, 2));
      setStatus("成绩表已导出为 JSON。");
    });
    document.getElementById("vRecClear").addEventListener("click", function () {
      if (!window.confirm("确定清空成绩表？此操作不可撤销。")) return;
      records = [];
      saveRecords(records);
      renderRecords();
      setStatus("成绩表已清空。");
    });
  }

  el.records.addEventListener("click", function (e) {
    var del = e.target.closest("[data-rec-del]");
    if (!del) return;
    records.splice(Number(del.getAttribute("data-rec-del")), 1);
    saveRecords(records);
    renderRecords();
  });

  function buildCalibration(action, A) {
    var Q = V.QUALITY_DEFAULTS;
    var reps = A.reps;
    var maxSweep = Math.max.apply(null, reps.map(function (r) { return r.sweep; }).concat([0]));
    var maxSupKnee = Math.max.apply(null, reps.map(function (r) { return r.supKnee; }).concat([0]));
    var maxKickKnee = Math.max.apply(null, reps.map(function (r) { return r.kickKnee; }).concat([0]));
    var maxJitter = Math.max.apply(null, reps.map(function (r) { return r.jitter; }).concat([0]));

    return {
      savedAt: new Date().toLocaleString("zh-CN"),
      quality: {
        sweepGood: Math.round(Math.max(30, maxSweep * 0.75)),
        supKneeMin: Math.round(Math.max(120, maxSupKnee - 8)),
        kickKneeMin: Math.round(Math.max(120, maxKickKnee - 8)),
        elbowMin: Q.elbowMin,
        jitterMax: Math.round(Math.max(0.03, maxJitter * 1.6) * 1000) / 1000,
        tempoCvMax: Math.round(Math.max(0.2, (A.intervalCv || 0.3) * 1.5) * 100) / 100,
        jumpHigh: Math.round(Math.max(0.25, A.jumpHeight * 0.9) * 100) / 100,
        jumpMid: Math.round(Math.max(0.15, A.jumpHeight * 0.6) * 100) / 100,
        stableJitter: Math.round(Math.max(0.04, maxJitter * 1.3) * 1000) / 1000,
        rotVelocityGood: Math.round(Math.max(150, A.maxYawVelocity * 0.8))
      },
      ref: A.peak ? {
        heel: A.peak.heel, toe: A.peak.toe, split: A.peak.split,
        supKnee: A.peak.supKnee, kickKnee: A.peak.kickKnee, sweep: A.peak.sweep,
        rotTotal: A.rotTotal, jumpHeight: A.jumpHeight, intervalCv: A.intervalCv
      } : null
    };
  }

  var LABELS = {
    sweepGood: "抡腿幅度达标值（°）",
    supKneeMin: "支撑腿伸直（°）",
    kickKneeMin: "踢击腿伸直（°）",
    elbowMin: "手臂伸直（°）",
    jitterMax: "支撑脚晃动上限（米）",
    tempoCvMax: "节奏离散度上限",
    jumpHigh: "腾空高度满分线（躯干倍数）",
    jumpMid: "腾空高度中线",
    stableJitter: "落地稳定上限（米）",
    rotVelocityGood: "转体速度达标（°/秒）"
  };

  function openCalibEditor(action) {
    var c = calibStore[action];
    if (!c) return;
    var html = '<div class="vpanel vcalib-editor"><h3>' + esc(action) + " · 阈值微调</h3><div class=\"vtable\">";
    Object.keys(c.quality).forEach(function (k) {
      html += '<div class="vtr vtr-edit"><span class="vtk">' + esc(LABELS[k] || k) + "</span>" +
        '<input type="number" step="0.01" data-qk="' + esc(k) + '" value="' + c.quality[k] + '" />' +
        '<span class="vtn">默认 ' + (V.QUALITY_DEFAULTS[k] != null ? V.QUALITY_DEFAULTS[k] : "—") + "</span></div>";
    });
    html += "</div><div class=\"vrow-btn\"><button type=\"button\" class=\"btn btn-primary\" id=\"vCalibSave\">保存</button>" +
      '<button type="button" class="btn" id="vCalibClose">关闭</button></div></div>';
    el.calibInfo.innerHTML += html;
    var box = el.calibInfo.querySelector(".vcalib-editor");
    document.getElementById("vCalibSave").addEventListener("click", function () {
      box.querySelectorAll("input[data-qk]").forEach(function (inp) {
        var v = parseFloat(inp.value);
        if (isFinite(v)) c.quality[inp.getAttribute("data-qk")] = v;
      });
      saveCalib(calibStore); calibStore = loadCalib();
      if (state.result) renderResult(state.result, state.analysis);
      renderCalibInfo();
    });
    document.getElementById("vCalibClose").addEventListener("click", function () { box.remove(); });
  }

  el.calibInfo.addEventListener("click", function (e) {
    var ed = e.target.closest("[data-calib-edit]");
    if (ed) { openCalibEditor(ed.getAttribute("data-calib-edit")); return; }
    var del = e.target.closest("[data-calib-del]");
    if (del) {
      delete calibStore[del.getAttribute("data-calib-del")];
      saveCalib(calibStore);
      renderCalibInfo();
      if (state.result) renderResult(state.result, state.analysis);
    }
  });

  /* ---------- 事件 ---------- */
  el.pickFile.addEventListener("click", function () { el.file.click(); });

  el.file.addEventListener("change", function () {
    var f = el.file.files && el.file.files[0];
    if (!f) return;
    stopCamera();
    state.src = "file";
    el.video.srcObject = null;
    el.video.src = URL.createObjectURL(f);
    el.video.loop = false;
    el.video.controls = false;
    el.stage.hidden = false;
    el.actions.hidden = false;
    el.start.disabled = false;
    el.start.textContent = "开始分析";
    el.results.innerHTML = "";
    setStatus("已载入：" + f.name);
    el.video.play().then(function () { el.video.pause(); });
  });

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) { t.stop(); });
      state.stream = null;
    }
  }

  el.pickCam.addEventListener("click", async function () {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      stopCamera();
      state.stream = stream;
      state.src = "camera";
      el.video.srcObject = stream;
      el.video.loop = false;
      el.stage.hidden = false;
      el.actions.hidden = false;
      el.start.disabled = false;
      el.start.textContent = "开始分析";
      el.results.innerHTML = "";
      await el.video.play();
      setStatus("摄像头已就绪。让被考核者全身入镜，然后点“开始分析”。");
    } catch (e) {
      setStatus("无法打开摄像头：" + e.message + "（需要 https 或 localhost 环境）");
    }
  });

  el.start.addEventListener("click", function () { run(); });

  el.replay.addEventListener("click", function () {
    if (state.src !== "file") { setStatus("摄像头模式没有可重放的录像。"); return; }
    el.video.currentTime = 0;
    el.video.play();
  });

  el.calib.addEventListener("click", function () {
    if (!state.analysis || !state.analysis.ok) { setStatus("先完成一次分析再标定。"); return; }
    var action = el.action.value;
    calibStore[action] = buildCalibration(action, state.analysis);
    saveCalib(calibStore);
    calibStore = loadCalib();
    setStatus("已把本次结果设为「" + action + "」的标定参考。");
    renderCalibInfo();
    if (state.result) renderResult(state.result, state.analysis);
  });

  el.record.addEventListener("click", function () {
    var R = state.result, A = state.analysis;
    if (!R || !A || !A.ok) { setStatus("先完成一次分析再记分。"); return; }
    var p = A.peak || {};
    var manualCount = R.checks.filter(function (c) { return c.status === "manual"; }).length;
    var kind = currentRule().kind;
    var needSweep = R.action === "里合腿" || R.action === "外摆腿" || kind === "rotation";
    var needRot = kind === "rotation" || kind === "jumpRotation";
    records.push({
      name: (el.name.value || "").trim(),
      action: R.action,
      base: R.base,
      deduct: R.deduct,
      score: R.score,
      repCount: A.repCount,
      countL: A.countL,
      countR: A.countR,
      heel: p.heel == null ? null : Math.round(p.heel * 100) / 100,
      supKnee: p.supKnee == null ? null : Math.round(p.supKnee * 10) / 10,
      kickKnee: p.kickKnee == null ? null : Math.round(p.kickKnee * 10) / 10,
      sweep: (needSweep && p.sweep != null) ? Math.round(p.sweep) : null,
      rotTotal: needRot ? Math.round(A.rotTotal) : null,
      manual: manualCount,
      time: new Date().toLocaleString("zh-CN")
    });
    saveRecords(records);
    renderRecords();
    setStatus("已记入成绩表：" + (el.name.value || "未填姓名") + " · " + R.action + " " + R.score + " 分");
  });

  el.action.addEventListener("change", function () {
    el.results.innerHTML = "";
    state.result = null;
    if (!currentRule()) {
      setStatus("「" + el.action.value + "」没有可量化的分档判据，无法自动评分。");
    } else {
      setStatus("已选择「" + el.action.value + "」。");
    }
    if (state.analysis && state.analysis.ok && currentRule()) {
      var R = V.evaluate(el.action.value, state.analysis, calibStore[el.action.value]);
      state.result = R;
      renderResult(R, state.analysis);
    }
  });

  /* ---------- 初始化 ---------- */
  buildActionOptions();
  renderCalibInfo();
  renderRecords();
  el.hint.innerHTML = "上传或实时拍摄动作视频，系统提取 33 点骨架 → 换算成以身体为参照的角度与高度 → " +
    "按文档分档文字判定档位并核对扣分项。<b>“跟过头顶 / 过下巴 / 脚尖过肩”这类判据来自文档本身，属于直接测量；" +
    "“抡腿明显、爆发力、节奏”这类没有数值的项，用教练示范视频标定。</b>";
  setStatus("选择动作后导入视频即可开始。");

  // 切换到别的页签时，停掉摄像头与正在进行的分析，避免后台占用
  window.WUSHU_VIDEO_UI = {
    onLeave: function () {
      state.running = false;
      if (state.camTimer) { clearTimeout(state.camTimer); state.camTimer = null; }
      stopCamera();
      try { el.video.pause(); } catch (e) { /* 忽略 */ }
      el.start.disabled = false;
    },
    // 供调试/标定排查使用：暴露原始采集帧与解析结果
    debug: function () { return { state: state, hasDetector: !!detector, source: detectorLabel }; }
  };
})();
