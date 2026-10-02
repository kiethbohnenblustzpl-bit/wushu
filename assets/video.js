/* 视频考核模块
 *
 * 做三件事：
 *   1) 用 MediaPipe PoseLandmarker 从视频里逐帧提取 33 点骨架；
 *   2) 把骨架换算成"以身体为参照"的指标（脚跟在头顶线之上多少、踢击腿膝盖角度……），
 *      这样指标不依赖拍摄距离和画面构图；
 *   3) 拿这些指标去套文档里的分档文字，输出档位、扣分与预估得分。
 *
 * 重要说明：文档中"跟过头顶/过下巴/脚尖过肩"本身就是几何判据，属于可直接测量项；
 * 而"抡腿明显、爆发力强、节奏分明、晃动"这类描述文档没有给数值，
 * 走标定流程——用教练的示范视频定标准，未标定时按暂定值判定并在界面上标明。
 */
(function () {
  "use strict";

  /* ---------- 骨架点编号（MediaPipe Pose 33 点） ---------- */
  var LM = {
    nose: 0, eyeLo: 2, eyeRo: 5, earL: 7, earR: 8, mouthL: 9, mouthR: 10,
    shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16,
    hipL: 23, hipR: 24, kneeL: 25, kneeR: 26,
    ankL: 27, ankR: 28, heelL: 29, heelR: 30, toeL: 31, toeR: 32
  };

  // 头部各参照线的解剖比例系数（相对"肩→鼻"距离），可按标定调整
  var HEAD_MODEL = {
    headTop: 2.0,   // 头顶 ≈ 鼻 + 2.0 × (眼 − 鼻)
    forehead: 1.5,  // 额头 ≈ 鼻 + 1.5 × (眼 − 鼻)
    chin: 0.6       // 下巴 ≈ 嘴 − 0.6 × (鼻 − 嘴)
  };

  var SKELETON = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
    [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
    [0, 11], [0, 12]
  ];

  /* ---------- 向量工具 ---------- */
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function unit(a) { var l = len(a) || 1e-9; return [a[0] / l, a[1] / l, a[2] / l]; }
  function angleAt(a, b, c) {
    var u = sub(a, b), v = sub(c, b);
    var d = dot(u, v) / ((len(u) * len(v)) || 1e-9);
    return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---------- 单帧特征 ---------- */
  // 所有高度都以"髋中点为原点、躯干长度为 1、身体朝上的方向为正"来表达。
  function frameFeatures(frame) {
    var w = (frame.world && frame.world.length >= 33) ? frame.world : frame.image;
    if (!w || w.length < 33) return null;
    function P(i) { return [w[i].x, w[i].y, w[i].z || 0]; }
    function vis(i) { return w[i].visibility == null ? 1 : w[i].visibility; }

    var hipMid = mid(P(LM.hipL), P(LM.hipR));
    var shMid = mid(P(LM.shL), P(LM.shR));
    var torsoVec = sub(shMid, hipMid);
    var torso = len(torsoVec);
    if (!(torso > 1e-6)) return null;
    var up = unit(torsoVec);
    function h(p) { return dot(sub(p, hipMid), up) / torso; }

    var eyeMid = mid(P(LM.eyeLo), P(LM.eyeRo));
    var mouthMid = mid(P(LM.mouthL), P(LM.mouthR));
    var eyeH = h(eyeMid), noseH = h(P(LM.nose)), mouthH = h(mouthMid);

    var lines = {
      shoulder: h(shMid),
      chin: mouthH - HEAD_MODEL.chin * (noseH - mouthH),
      forehead: noseH + HEAD_MODEL.forehead * (eyeH - noseH),
      headTop: noseH + HEAD_MODEL.headTop * (eyeH - noseH),
      ear: h(mid(P(LM.earL), P(LM.earR)))
    };

    var leg = {
      L: { hip: h(P(LM.hipL)), knee: h(P(LM.kneeL)), ankle: h(P(LM.ankL)), heel: h(P(LM.heelL)), toe: h(P(LM.toeL)) },
      R: { hip: h(P(LM.hipR)), knee: h(P(LM.kneeR)), ankle: h(P(LM.ankR)), heel: h(P(LM.heelR)), toe: h(P(LM.toeR)) }
    };
    var kneeAngle = {
      L: angleAt(P(LM.hipL), P(LM.kneeL), P(LM.ankL)),
      R: angleAt(P(LM.hipR), P(LM.kneeR), P(LM.ankR))
    };
    var elbowAngle = {
      L: angleAt(P(LM.shL), P(LM.elL), P(LM.wrL)),
      R: angleAt(P(LM.shR), P(LM.elR), P(LM.wrR))
    };
    // 两腿在髋部的夹角（腾空正踢腿的"两腿幅度"）
    var legSplit = angleAt(P(LM.kneeL), P(LM.hipL), P(LM.kneeR));

    // 髋轴方向 → 身体绕垂直轴的转角（跳跃旋转类动作）
    var hipAxis = sub(P(LM.hipR), P(LM.hipL));
    var axisUp = dot(hipAxis, up);
    var flat = [hipAxis[0] - axisUp * up[0], hipAxis[1] - axisUp * up[1], hipAxis[2] - axisUp * up[2]];
    var yaw = Math.atan2(flat[2], flat[0]) * 180 / Math.PI;

    var minVis = Math.min(
      vis(LM.hipL), vis(LM.hipR), vis(LM.shL), vis(LM.shR),
      vis(LM.kneeL), vis(LM.kneeR), vis(LM.ankL), vis(LM.ankR)
    );

    return {
      t: frame.t, image: frame.image, world: frame.world,
      hipMid: hipMid, shMid: shMid, up: up, torso: torso,
      lines: lines, leg: leg, kneeAngle: kneeAngle, elbowAngle: elbowAngle,
      legSplit: legSplit, yaw: yaw, vis: minVis, hipH: 0
    };
  }

  /* ---------- 序列层指标 ---------- */
  function unwrapDeg(vals) {
    var out = new Array(vals.length), acc = 0, prev = vals.length ? vals[0] : 0;
    if (vals.length) out[0] = 0;
    for (var i = 1; i < vals.length; i++) {
      var d = vals[i] - prev;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      acc += d;
      out[i] = acc;
      prev = vals[i];
    }
    return out;
  }

  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // 从"任一条腿的最高脚尖"信号里找踢腿波峰。
  // 不对左右腿分别找峰：侧视角下左右腿天然贴近，分别找会产生重叠的重复峰值。
  // 另外只取局部极大值不够，一次起腿-回收常出现两个小峰，
  // 因此要求两峰之间存在足够深的"谷"（突出度），否则合并成一个。
  function findPeaksOnSignal(vals, F, minH, minGapSec, minProm) {
    var raw = [];
    for (var i = 1; i < vals.length - 1; i++) {
      if (vals[i] >= vals[i - 1] && vals[i] > vals[i + 1] && vals[i] > minH) {
        raw.push({ i: i, t: F[i].t, h: vals[i] });
      }
    }
    var out = [];
    for (var j = 0; j < raw.length; j++) {
      var p = raw[j];
      var last = out[out.length - 1];
      if (last && p.t - last.t < minGapSec) {
        if (p.h > last.h) out[out.length - 1] = p;
        continue;
      }
      if (last) {
        var valley = Infinity;
        for (var k = last.i; k <= p.i; k++) valley = Math.min(valley, vals[k]);
        if (Math.min(last.h, p.h) - valley < minProm) {
          if (p.h > last.h) out[out.length - 1] = p;
          continue;
        }
      }
      out.push(p);
    }
    return out;
  }

  var MIN_GAP_SEC = 0.40;      // 两次踢腿的最小间隔，避免一个动作被算成多次
  var TOE_RAISE_MIN = 0.35;    // 脚尖至少比静止时抬高多少（躯干倍数）才算一次踢腿
  var MIN_PROMINENCE = 0.28;   // 两峰之间必须回落至少这么多，才算两次独立的踢腿

  function analyzeSequence(frames) {
    var F = [];
    for (var i = 0; i < frames.length; i++) {
      var f = frameFeatures(frames[i]);
      if (f && f.vis > 0.4) F.push(f);
    }
    if (F.length < 5) return { ok: false, reason: "有效骨架帧太少（" + F.length + " 帧），请用画面清晰、全身入镜的视频。" };

    // 基准高度用整段的 20 分位，比"开头几帧"更抗"视频从中途开始"
    function pct(arr, p) {
      var s = arr.slice().sort(function (a, b) { return a - b; });
      return s[Math.max(0, Math.min(s.length - 1, Math.floor((s.length - 1) * p)))];
    }
    var base = Math.min(
      pct(F.map(function (x) { return x.leg.L.toe; }), 0.2),
      pct(F.map(function (x) { return x.leg.R.toe; }), 0.2)
    );
    // 一次踢腿至少要抬到髋线附近；否则只是站立时的重心变化，不该算一次
    var minH = Math.max(base + TOE_RAISE_MIN, 0.10);
    var signal = F.map(function (x) { return Math.max(x.leg.L.toe, x.leg.R.toe); });
    var peaks = findPeaksOnSignal(signal, F, minH, MIN_GAP_SEC, MIN_PROMINENCE);

    // 旋转总量、腾空高度
    var yawUnwrapped = unwrapDeg(F.map(function (x) { return x.yaw; }));
    var rotTotal = 0;
    for (var k = 1; k < yawUnwrapped.length; k++) rotTotal += Math.abs(yawUnwrapped[k] - yawUnwrapped[k - 1]);
    var rotSigned = Math.abs(yawUnwrapped[yawUnwrapped.length - 1]);

    var hipHeights = F.map(function (x) { return x.leg.L.hip + x.leg.R.hip; }).map(function (v) { return v / 2; });
    var baseHip = median(hipHeights.slice(0, Math.max(3, Math.floor(F.length * 0.15))));
    var peakHip = Math.max.apply(null, hipHeights);

    var ankleMinByFrame = F.map(function (x) { return Math.min(x.leg.L.ankle, x.leg.R.ankle); });
    var baseAnkle = median(ankleMinByFrame.slice(0, Math.max(3, Math.floor(F.length * 0.15))));
    var flightFrames = 0;
    ankleMinByFrame.forEach(function (v) { if (v > baseAnkle + 0.25) flightFrames++; });

    // 倒立占比（侧手翻）：身体朝上的方向与站立时相反
    var standUp = F[Math.min(F.length - 1, Math.max(0, Math.floor(F.length * 0.1)))].up;
    var invertedFrames = 0;
    F.forEach(function (x) {
      var c = dot(x.up, standUp);
      if (c < -0.2) invertedFrames++;
    });
    var invertedRatio = F.length ? invertedFrames / F.length : 0;

    var yawVelocity = [];
    for (var j = 1; j < yawUnwrapped.length; j++) {
      var dt = F[j].t - F[j - 1].t;
      if (dt > 1e-3) yawVelocity.push(Math.abs(yawUnwrapped[j] - yawUnwrapped[j - 1]) / dt);
    }

    var perRep = peaks.map(function (p) {
      var fr = F[p.i];
      var kickSide = fr.leg.L.toe >= fr.leg.R.toe ? "L" : "R";
      var supSide = kickSide === "L" ? "R" : "L";

      // 一个动作窗口：波峰前后各 0.45 秒
      var lo = p.i, hi = p.i;
      while (lo > 0 && F[p.i].t - F[lo].t < 0.45) lo--;
      while (hi < F.length - 1 && F[hi].t - F[p.i].t < 0.45) hi++;
      var win = F.slice(lo, hi + 1);

      // 判定用"踢到最高点"那一刻的支撑腿角度；窗口最小值只作参考，
      // 因为起腿/落腿过程中的瞬时弯曲不等于动作错误。
      var supKneeAtPeak = fr.kneeAngle[supSide];
      var supKneeMin = Math.min.apply(null, win.map(function (x) { return x.kneeAngle[supSide]; }));
      var kickKnee = fr.kneeAngle[kickSide];
      var elbowMin = Math.min(
        Math.min.apply(null, win.map(function (x) { return x.elbowAngle.L; })),
        Math.min.apply(null, win.map(function (x) { return x.elbowAngle.R; }))
      );
      // 判定用的是"踢到最高点"那一刻的手臂形态；窗口最小值只作参考
      var elbowAtPeak = Math.min(fr.elbowAngle.L, fr.elbowAngle.R);
      // 晃动：只看"离地更近的那只脚"的水平位移。
      // 侧视角下模型偶尔会把左右腿标反，所以不能固定看某一侧；
      // 并且用中位数与 80 分位而不是最大位移，避免个别坏帧放大结果。
      var floorPts = [];
      win.forEach(function (x) {
        var idx = (x.leg.L.ankle <= x.leg.R.ankle) ? LM.ankL : LM.ankR;
        if (!x.world || !x.world[idx]) return;
        floorPts.push([x.world[idx].x, x.world[idx].z || 0]);
      });
      var jitter = 0;
      if (floorPts.length > 2) {
        var mx = median(floorPts.map(function (q) { return q[0]; }));
        var mz = median(floorPts.map(function (q) { return q[1]; }));
        var dists = floorPts.map(function (q) { return Math.hypot(q[0] - mx, q[1] - mz); })
          .sort(function (a, b) { return a - b; });
        jitter = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.8))];
      }

      // 起腿速度（爆发力代理指标）
      var startIdx = lo, startH = F[lo].leg[kickSide].toe;
      for (var s = p.i; s >= lo; s--) {
        if (F[s].leg[kickSide].toe < startH + 0.05) { startIdx = s; break; }
        startH = Math.min(startH, F[s].leg[kickSide].toe);
        startIdx = s;
      }
      var riseSec = Math.max(0.05, F[p.i].t - F[startIdx].t);
      var burst = (fr.leg[kickSide].toe - F[startIdx].leg[kickSide].toe) / riseSec;

      // 抡腿幅度：窗口内脚尖横向扫过的角度范围（里合/外摆的"抡腿明显"）
      var toeXs = win.map(function (x) {
        var idx = kickSide === "L" ? LM.toeL : LM.toeR;
        var hipIdx = kickSide === "L" ? LM.hipL : LM.hipR;
        var src = (x.world && x.world.length >= 33) ? x.world : null;
        if (!src) return 0;
        var v = sub([src[idx].x, src[idx].y, src[idx].z || 0], [src[hipIdx].x, src[hipIdx].y, src[hipIdx].z || 0]);
        return Math.atan2(v[0], -v[1]) * 180 / Math.PI;
      });
      var sweep = Math.max.apply(null, toeXs) - Math.min.apply(null, toeXs);

      return {
        t: p.t, side: kickSide,
        heel: fr.leg[kickSide].heel, toe: fr.leg[kickSide].toe,
        ankle: fr.leg[kickSide].ankle,
        kickKnee: kickKnee, supKnee: supKneeAtPeak, supKneeMin: supKneeMin,
        elbow: elbowAtPeak, elbowMin: elbowMin,
        split: fr.legSplit, burst: burst, sweep: sweep, jitter: jitter,
        lines: fr.lines, frameIndex: p.i
      };
    });

    var countL = perRep.filter(function (r) { return r.side === "L"; }).length;
    var countR = perRep.filter(function (r) { return r.side === "R"; }).length;
    var intervals = [];
    for (var q = 1; q < perRep.length; q++) intervals.push(perRep[q].t - perRep[q - 1].t);
    var intervalCv = 0;
    if (intervals.length >= 2) {
      var mean = intervals.reduce(function (a, b) { return a + b; }, 0) / intervals.length;
      var varr = intervals.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / intervals.length;
      intervalCv = mean > 0 ? Math.sqrt(varr) / mean : 0;
    }

    return {
      ok: true,
      frames: F,
      reps: perRep,
      repCount: perRep.length,
      countL: countL, countR: countR,
      intervalCv: intervalCv,
      peak: perRep.length ? perRep.reduce(function (a, b) { return b.toe > a.toe ? b : a; }) : null,
      rotTotal: rotTotal, rotSigned: rotSigned,
      peakHip: peakHip, baseHip: baseHip,
      jumpHeight: peakHip - baseHip,
      flightSec: flightFrames * (F.length > 1 ? (F[F.length - 1].t - F[0].t) / F.length : 0),
      flightRatio: F.length ? flightFrames / F.length : 0,
      invertedRatio: invertedRatio,
      maxYawVelocity: yawVelocity.length ? Math.max.apply(null, yawVelocity) : 0,
      duration: F.length > 1 ? F[F.length - 1].t - F[0].t : 0,
      lines: F[Math.floor(F.length / 2)].lines
    };
  }

  /* ---------- 动作判定规则 ---------- */
  // 分档判据直接来自文档文字；quality 类判据文档未给数值，按标定或暂定值判定。
  var RULES = {
    "正踢腿": {
      kind: "legHeight",
      levels: [
        { score: 10, text: "起踢腿跟过头顶或触额头，节奏分明，爆发力强", point: "heel", line: "forehead" },
        { score: 8, text: "起踢腿跟过下巴，有较强爆发力与协调力", point: "heel", line: "chin" },
        { score: 6, text: "起踢腿尖过肩，有一定的节奏与爆发", point: "toe", line: "shoulder" }
      ],
      fallback: { score: 4, text: "踢腿未过肩，且无节奏感与力感" },
      reps: { required: 8, note: "8次（左右各4次）", balance: true },
      deductions: [
        { id: "supKnee", label: "支撑腿弯曲", auto: true, rule: "每项1分，不累计扣分" },
        { id: "kickKnee", label: "踢击腿弯曲", auto: true },
        { id: "elbow", label: "手臂弯曲", auto: true, confidence: "low" },
        { id: "handShape", label: "掌型不达标", auto: false },
        { id: "continuous", label: "未连续踢腿", auto: true }
      ]
    },
    "侧踢腿": {
      kind: "legHeight",
      levels: [
        { score: 10, text: "起踢腿跟过头顶或触额头，节奏分明，爆发力强", point: "heel", line: "forehead" },
        { score: 8, text: "起踢腿跟过下巴，有较强爆发力与协调力", point: "heel", line: "chin" },
        { score: 6, text: "起踢腿尖过肩，有一定的节奏与爆发", point: "toe", line: "shoulder" }
      ],
      fallback: { score: 4, text: "踢腿未过肩，且无节奏感与力感" },
      reps: { required: 8, note: "8次（左右各4次）", balance: true },
      deductions: [
        { id: "supKnee", label: "支撑腿弯曲", auto: true, rule: "每项1分，不累计扣分" },
        { id: "kickKnee", label: "踢击腿弯曲", auto: true },
        { id: "elbow", label: "手臂弯曲", auto: true, confidence: "low" },
        { id: "handShape", label: "掌型不达标", auto: false },
        { id: "continuous", label: "未连续踢腿", auto: true }
      ]
    },
    "里合腿": {
      kind: "legHeight",
      levels: [
        { score: 10, text: "起踢腿跟过下巴且抡腿明显，节奏分明，爆发力强", point: "heel", line: "chin", needSweep: true },
        { score: 8, text: "起踢腿跟过下巴且抡腿明显，有较强爆发力与协调力", point: "heel", line: "chin" },
        { score: 6, text: "起踢腿尖过肩且抡腿（向内）明显，有一定的节奏与爆发", point: "toe", line: "shoulder" }
      ],
      fallback: { score: 4, text: "踢腿未过肩或抡腿不明显，且无节奏感与力感" },
      reps: { required: 8, note: "8次（左右各4次）", balance: true },
      deductions: [
        { id: "supKnee", label: "支撑腿弯曲", auto: true, rule: "每项1分，不累计扣分" },
        { id: "kickKnee", label: "踢击腿弯曲", auto: true },
        { id: "elbow", label: "手臂弯曲", auto: true, confidence: "low" },
        { id: "handShape", label: "掌型不达标", auto: false },
        { id: "noSound", label: "未击响", auto: false },
        { id: "continuous", label: "未连续踢腿", auto: true },
        { id: "smallSweep", label: "摆腿幅度过小", auto: true }
      ]
    },
    "外摆腿": {
      kind: "legHeight",
      levels: [
        { score: 10, text: "起踢腿跟过下巴且抡腿明显，爆发力强", point: "heel", line: "chin", needSweep: true },
        { score: 8, text: "起踢腿跟过下巴且抡腿明显，有较强爆发力与协调力", point: "heel", line: "chin" },
        { score: 6, text: "起踢腿尖过肩且抡腿（向外）明显，有一定的节奏与爆发", point: "toe", line: "shoulder" }
      ],
      fallback: { score: 4, text: "踢腿未过肩或抡腿不明显，且无节奏感与力感" },
      reps: { required: 8, note: "8次（左右各4次）", balance: true },
      deductions: [
        { id: "supKnee", label: "支撑腿弯曲", auto: true, rule: "每项1分，不累计扣分" },
        { id: "kickKnee", label: "踢击腿弯曲", auto: true },
        { id: "elbow", label: "手臂弯曲", auto: true, confidence: "low" },
        { id: "handShape", label: "掌型不达标", auto: false },
        { id: "noSound", label: "未击响", auto: false },
        { id: "continuous", label: "未连续踢腿", auto: true },
        { id: "smallSweep", label: "摆腿幅度过小", auto: true }
      ]
    },
    "后扫腿": {
      kind: "rotation",
      levels: [
        { score: 10, text: "扫腿360°且动作稳定流畅，且美观", rot: 360, needSweep: true },
        { score: 8, text: "扫腿达360°，扫腿较流畅流畅", rot: 360 },
        { score: 6, text: "扫腿达180°，扫腿较流畅稳定", rot: 180 }
      ],
      fallback: { score: 4, text: "扫腿未达180°，动作不流畅" },
      reps: { required: 3, note: "3次" },
      deductions: [
        { id: "hold", label: "定势未两秒", auto: false },
        { id: "sweepKnee", label: "扫转腿弯曲超45°", auto: true },
        { id: "wobble", label: "晃动", auto: true },
        { id: "handDown", label: "扶地过久或多次扶地", auto: false },
        { id: "footUp", label: "扫腿脚掌离地", auto: true, confidence: "low" }
      ]
    },
    "腾空飞脚": {
      kind: "kickInAir",
      levels: [
        { score: 10, text: "动作连贯，节奏分明，有强爆发力（起跳腿落地）", point: "toe", line: "chin" },
        { score: 8, text: "动作连贯，节奏分明，有较强爆发力（双腿落地）", point: "toe", line: "shoulder" }
      ],
      fallback: { score: 4, text: "动作完成度差" },
      reps: { required: 2, note: "2次" },
      deductions: [
        { id: "noSound", label: "未击响", auto: false },
        { id: "steps", label: "上步超过四步", auto: false },
        { id: "kickLower", label: "击响时脚尖未过下巴", auto: true }
      ]
    },
    "外摆莲": {
      kind: "jumpRotation",
      levels: [
        { score: 10, text: "超过450°，落地平稳，且有高爆发力与协调力", rot: 450, needStable: true },
        { score: 8, text: "超过360°，落地平稳，且有较高爆发力与协调力", rot: 360, needStable: true },
        { score: 6, text: "超过270°，落地平稳，且有一定爆发力与协调力", rot: 270, needStable: true }
      ],
      fallback: { score: 4, text: "未超270°，落地平稳" },
      reps: { required: 2, note: "2次" },
      deductions: [
        { id: "wobble", label: "晃动", auto: true },
        { id: "stance", label: "马步或坐盘不合规范", auto: false },
        { id: "shift", label: "挪动（每挪动扣1）", auto: true, confidence: "low" },
        { id: "noSound", label: "未击响", auto: false },
        { id: "soundLow", label: "击响未过下巴", auto: true },
        { id: "landing", label: "落地先后脚", auto: false },
        { id: "steps", label: "上步超过四步", auto: false }
      ]
    },
    "旋风脚": {
      kind: "jumpRotation",
      levels: [
        { score: 10, text: "超过450°，落地平稳", rot: 450, needStable: true },
        { score: 8, text: "超过360°，落地平稳", rot: 360, needStable: true },
        { score: 6, text: "超过270°，落地平稳", rot: 270, needStable: true }
      ],
      fallback: { score: 4, text: "未超270°，落地平稳" },
      reps: { required: 2, note: "2次" },
      deductions: [
        { id: "wobble", label: "晃动", auto: true },
        { id: "stance", label: "马步或坐盘不合规范", auto: false },
        { id: "shift", label: "挪动（每挪动扣1）", auto: true, confidence: "low" },
        { id: "noSound", label: "未击响", auto: false },
        { id: "soundLow", label: "击响未过肩", auto: true },
        { id: "landing", label: "落地先后脚", auto: false },
        { id: "steps", label: "上步超过四步", auto: false }
      ]
    },
    "旋子": {
      kind: "jumpHeight",
      levels: [
        { score: 10, text: "腾空高，落地稳，体态自如，上步连贯" },
        { score: 8, text: "腾空较高，落地稳，体态较自如，上步较连贯" },
        { score: 6, text: "腾空一般，落地较稳，体态拘束，上步不连贯" }
      ],
      fallback: { score: 4, text: "倒地或未完全腾空" },
      reps: { required: 2, note: "2次" },
      deductions: [
        { id: "bentKnee", label: "弯腿超过45°", auto: true },
        { id: "steps", label: "上步超过四步", auto: false }
      ]
    },
    "腾空正踢腿": {
      kind: "split",
      levels: [
        { score: 10, text: "踢击额头或超过头顶且两腿幅度超135°", point: "toe", line: "forehead", split: 135 },
        { score: 8, text: "脚跟超过耳朵且两腿幅度超135°", point: "heel", line: "ear", split: 135 },
        { score: 6, text: "脚跟过肩且两腿幅度超135°", point: "heel", line: "shoulder", split: 135 }
      ],
      fallback: { score: 4, text: "下腿弯曲，两腿未超135°" },
      reps: { required: 2, note: "2次" },
      deductions: [
        { id: "kickKnee", label: "踢击腿弯曲", auto: true }
      ]
    },
    "侧手翻": {
      kind: "inversion",
      levels: [
        { score: 10, text: "侧翻圆，速度快且连续完成" },
        { score: 8, text: "侧翻圆，速度快" },
        { score: 6, text: "侧翻较圆，速度一般" }
      ],
      fallback: { score: 4, text: "侧翻倒地" },
      reps: { required: 3, note: "3次" },
      deductions: [
        { id: "notContinuous", label: "动作不连贯", auto: true },
        { id: "hip", label: "屈髋或冲肩", auto: false },
        { id: "elbow", label: "手臂弯曲", auto: true, confidence: "low" },
        { id: "stretch", label: "伸腿展髋不充分", auto: false }
      ]
    }
  };

  // 文档未给出数值、需要标定的质量阈值（暂定值）
  var QUALITY_DEFAULTS = {
    sweepGood: 70,     // 抡腿幅度（度）：里合/外摆"抡腿明显"
    kickKneeMin: 160,  // 踢击腿伸直度：膝盖角小于此值判为"弯曲"
    supKneeMin: 165,   // 支撑腿伸直度
    elbowMin: 150,     // 手臂伸直度
    jitterMax: 0.12,   // 支撑脚横向晃动（米）
    tempoCvMax: 0.35,  // 节奏离散度，越小越均匀
    jumpHigh: 0.55,    // 腾空高度（躯干倍数）
    jumpMid: 0.35,
    stableJitter: 0.10,
    rotVelocityGood: 400
  };

  /* ---------- 评分 ---------- */
  function pickLevel(rule, A) {
    if (!A.peak) return null;
    var p = A.peak;
    for (var i = 0; i < rule.levels.length; i++) {
      var L = rule.levels[i];
      var ok = true;
      if (rule.kind === "legHeight" || rule.kind === "split" || rule.kind === "kickInAir") {
        if (L.line) ok = ok && (p[L.point] >= p.lines[L.line]);
        if (L.split) ok = ok && (p.split > L.split);
      } else if (rule.kind === "rotation" || rule.kind === "jumpRotation") {
        if (L.rot) ok = ok && (A.rotTotal >= L.rot);
      } else if (rule.kind === "jumpHeight") {
        if (i === 0) ok = A.jumpHeight >= QUALITY_DEFAULTS.jumpHigh;
        else if (i === 1) ok = A.jumpHeight >= QUALITY_DEFAULTS.jumpMid;
        else ok = A.jumpHeight > 0.12;
      } else if (rule.kind === "inversion") {
        if (i === 0) ok = A.invertedRatio > 0.15 && A.maxYawVelocity > 120;
        else if (i === 1) ok = A.invertedRatio > 0.08;
        else ok = A.invertedRatio > 0.02;
      }
      if (ok) return { level: L, score: L.score, text: L.text, matchedIndex: i };
    }
    return null;
  }

  function evaluate(actionKey, A, calib) {
    var rule = RULES[actionKey];
    if (!rule) return null;
    var Q = Object.assign({}, QUALITY_DEFAULTS, (calib && calib.quality) || {});
    var hit = pickLevel(rule, A);
    var base = hit ? hit.score : rule.fallback.score;
    var text = hit ? hit.text : rule.fallback.text;

    var checks = [];
    var anyDeduct = false;
    var ruleText = "";

    rule.deductions.forEach(function (d) {
      if (!d.auto) {
        checks.push({ label: d.label, status: "manual", detail: "无法从骨架判断" });
        return;
      }
      var bad = false, detail = "";
      if (d.id === "supKnee") {
        var mn = Math.min.apply(null, A.reps.map(function (r) { return r.supKnee; }).concat([999]));
        bad = mn < Q.supKneeMin;
        detail = "踢到最高点时 " + mn.toFixed(1) + "°（≥" + Q.supKneeMin + "° 为伸直）";
      } else if (d.id === "kickKnee" || d.id === "bentKnee") {
        var mk = Math.min.apply(null, A.reps.map(function (r) { return r.kickKnee; }).concat([999]));
        var lim = d.id === "bentKnee" ? 135 : Q.kickKneeMin;
        bad = mk < lim;
        detail = "最小 " + mk.toFixed(1) + "°（≥" + lim + "° 合格）";
      } else if (d.id === "elbow") {
        var me = Math.min.apply(null, A.reps.map(function (r) { return r.elbow; }).concat([999]));
        bad = me < Q.elbowMin;
        detail = "踢到最高点时 " + me.toFixed(1) + "°（≥" + Q.elbowMin + "° 为伸直）";
      } else if (d.id === "continuous") {
        bad = A.intervalCv > Q.tempoCvMax;
        detail = "节奏离散度 " + A.intervalCv.toFixed(2) + "（≤" + Q.tempoCvMax + " 算均匀）";
      } else if (d.id === "smallSweep") {
        var sw = Math.max.apply(null, A.reps.map(function (r) { return r.sweep; }).concat([0]));
        bad = sw < Q.sweepGood;
        detail = "最大抡腿 " + sw.toFixed(0) + "°（≥" + Q.sweepGood + "° 算明显）";
      } else if (d.id === "wobble") {
        var jt = Math.max.apply(null, A.reps.map(function (r) { return r.jitter; }).concat([0]));
        bad = jt > Q.jitterMax;
        detail = "支撑脚位移 " + jt.toFixed(3) + " 米（≤" + Q.jitterMax + " 算稳定）";
      } else if (d.id === "shift") {
        bad = false;
        detail = "落地位移需人工确认";
      } else if (d.id === "sweepKnee") {
        var sk = Math.min.apply(null, A.reps.map(function (r) { return r.kickKnee; }).concat([999]));
        bad = sk < 135;
        detail = "扫转腿膝角最小 " + sk.toFixed(1) + "°（≥135° 合格）";
      } else if (d.id === "footUp") {
        detail = "需人工确认脚掌是否离地";
        bad = false;
      } else if (d.id === "kickLower") {
        var low = A.reps.filter(function (r) { return r.toe < r.lines.chin; }).length;
        bad = low > 0;
        detail = low ? (low + " 次击响时脚尖未过下巴") : "全部击响脚尖过下巴";
      } else if (d.id === "soundLow") {
        var low2 = A.reps.filter(function (r) { return r.toe < r.lines.chin; }).length;
        bad = low2 > 0;
        detail = low2 ? (low2 + " 次击响位置偏低") : "击响位置达标";
      } else if (d.id === "notContinuous") {
        bad = A.repCount < 2;
        detail = "检测到 " + A.repCount + " 次";
      } else {
        bad = false;
        detail = "未实现自动判定";
      }

      // 自动判定把握较低的项目只提示、不扣分：宁可让教练复核，
      // 也不要因为一次骨架抖动让学生白丢一分。
      if (bad && d.confidence === "low") {
        checks.push({
          label: d.label, status: "manual",
          detail: detail + "；自动判定把握较低，请人工确认",
          confidence: "low"
        });
        return;
      }
      if (bad) {
        anyDeduct = true;
        if (d.rule) ruleText = d.rule;
      }
      checks.push({
        label: d.label,
        status: bad ? "fail" : "pass",
        detail: detail,
        confidence: d.confidence || ""
      });
    });

    var deduct = anyDeduct ? 1 : 0;
    var score = Math.max(0, base - deduct);

    return {
      action: actionKey,
      base: base, text: text, deduct: deduct, score: score,
      ruleText: ruleText,
      checks: checks,
      repRule: rule.reps
    };
  }

  /* ---------- 暴露 ---------- */
  window.WUSHU_VIDEO = {
    RULES: RULES,
    QUALITY_DEFAULTS: QUALITY_DEFAULTS,
    HEAD_MODEL: HEAD_MODEL,
    LM: LM,
    SKELETON: SKELETON,
    analyzeSequence: analyzeSequence,
    evaluate: evaluate,
    frameFeatures: frameFeatures,
    util: { sub: sub, mid: mid, dot: dot, len: len, unit: unit, angleAt: angleAt, median: median, lerp: lerp }
  };
})();
