/*
 * 中国地铁模拟器 — 自研驾驶引擎
 * 仿照济南 3D 驾驶模拟器的交互与判分逻辑，用 Canvas 2D 实现，
 * 完全离线、无外部依赖、无外部平台。站名为真实数据（见 data.js）。
 * 隐藏署名：_t = "eXR5MTY=" (Base64 "yty16")。
 */
(function () {
  "use strict";

  var _t = "eXR5MTY="; // 隐藏署名，不展示

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---- 中文语音合成（在线/离线均可用） ----
  var voiceCache = null;
  function pickZhVoice() {
    if (!("speechSynthesis" in window)) return null;
    if (voiceCache) return voiceCache;
    var vs = window.speechSynthesis.getVoices() || [];
    for (var i = 0; i < vs.length; i++) {
      if (/zh|cmn|Chinese/i.test(vs[i].lang + vs[i].name)) { voiceCache = vs[i]; return voiceCache; }
    }
    return null;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = function () { voiceCache = null; pickZhVoice(); };
  }
  var voiceEnabled = true;
  function announce(zh, en) {
    if (!voiceEnabled || !("speechSynthesis" in window)) return;
    try {
      var u = new SpeechSynthesisUtterance(zh);
      var v = pickZhVoice();
      if (v) u.voice = v;
      u.lang = "zh-CN"; u.rate = 1.05; u.pitch = 1.0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  // ---- 轻量音效（WebAudio，可选） ----
  var actx = null, engineOsc = null, engineGain = null, soundOn = true, volume = 0.5;
  function audio() {
    if (!soundOn) return null;
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (actx.state === "suspended") actx.resume();
    return actx;
  }
  function startEngineHum() {
    var a = audio(); if (!a) return;
    if (engineOsc) return;
    engineOsc = a.createOscillator(); engineGain = a.createGain();
    engineOsc.type = "sawtooth"; engineOsc.frequency.value = 42;
    engineGain.gain.value = 0.0; engineOsc.connect(engineGain); engineGain.connect(a.destination);
    engineOsc.start();
  }
  function stopEngineHum() {
    if (engineOsc) { try { engineOsc.stop(); } catch (e) {} engineOsc = null; engineGain = null; }
  }
  function setHum(speed) {
    if (!engineGain) return;
    var f = 42 + speed * 0.9;
    engineGain.gain.value = clamp(speed / 90 * 0.05 * volume, 0, 0.06);
    engineOsc.frequency.value = f;
  }
  function beep(freq, ms, type) {
    var a = audio(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || "sine"; o.frequency.value = freq;
    g.gain.value = 0.12 * volume; o.connect(g); g.connect(a.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + (ms || 150) / 1000);
    o.stop(a.currentTime + (ms || 150) / 1000 + 0.02);
  }

  // ============ 模拟器 ============
  function Sim(opts) {
    this.mount = opts.mount;
    this.onExit = opts.onExit || function () {};
    this.raf = 0;
    this.running = false;
  }

  Sim.prototype.start = function (cfg) {
    this.cfg = cfg;
    this.stations = cfg.stations;
    this.startIdx = cfg.startIdx;
    this.legs = cfg.legs;
    this.targetIdx = Math.min(this.startIdx + this.legs, this.stations.length - 1);
    this.mode = cfg.mode || "manual";
    this.color = cfg.color || "#e3002b";
    this.lineName = cfg.lineName || "";
    this.city = cfg.city || "";

    // 站间距：取真实运营的平均水平做模拟（约 1.2km），非编造具体里程
    this.seg = 1200;
    this.pos = 0;            // 距当前段起点（上一站）的里程 (m)
    this.v = 0;              // m/s
    this.notch = 0;          // -7..+4 (负=制动档，0=N，正=牵引)
    this.phase = "run";      // run | docked | done
    this.segIndex = this.startIdx; // 当前所在段起点站索引
    this.dwell = 0;
    this.bc = 0;             // 制动缸 kPa
    this.accel = 0;
    this.scoreList = [];
    this.smoothPenalty = 0;
    this.maxOver = 0;
    this.lastT = 0;
    this.paused = false;

    this.build();
    this.updateSelectInfo();
    this.announceStart();
    this.setHint("↑/↓ 或 ▲▼ 升降级位牵引制动 · 到站对标停车后开门、发车确认");
    this.setNotch(1); // 始发即动车
    this.running = true;
    startEngineHum();
    var self = this;
    this.lastT = performance.now();
    this.loop = function (t) {
      if (!self.running) return;
      var dt = (t - self.lastT) / 1000; self.lastT = t;
      dt = clamp(dt, 0, 0.05);
      if (!self.paused) self.step(dt);
      self.render();
      self.raf = requestAnimationFrame(self.loop);
    };
    this.raf = requestAnimationFrame(this.loop);
  };

  Sim.prototype.build = function () {
    var m = this.mount;
    m.innerHTML =
      '<div class="cm-cab">' +
      '  <canvas class="cm-fwd" id="cm-fwd"></canvas>' +
      '  <div class="cm-cabframe"><i class="cm-pillar l"></i><i class="cm-pillar r"></i><i class="cm-roof"></i><i class="cm-desk"></i></div>' +
      '  <div class="cm-led">' +
      '    <button class="cm-pause" id="cm-pause">Ⅱ</button>' +
      '    <span class="cm-ledline" id="cm-ledline"></span>' +
      '    <span class="cm-next"><small>下一站 NEXT</small><b id="cm-next">—</b></span>' +
      '    <span class="cm-door" id="cm-door">本侧开门</span>' +
      '  </div>' +
      '  <div class="cm-ann" id="cm-ann"><b id="cm-ann-zh">—</b></div>' +
      '  <div class="cm-topwrap">' +
      '    <div class="cm-tophead"><span>对位俯视图</span><span id="cm-dist">—</span></div>' +
      '    <canvas class="cm-top" id="cm-top"></canvas>' +
      '    <div class="cm-topleg"><i class="lg g"></i>停车区 <i class="lg h"></i>车头 <i class="lg p"></i>预计停车</div>' +
      '  </div>' +
      '  <div class="cm-marker" id="cm-marker"><b id="cm-mk">—</b><span>停车标</span></div>' +
      '  <div class="cm-controls">' +
      '    <div class="cm-handle panel">' +
      '      <div class="cm-ptitle"><b>主控手柄</b><span id="cm-hstate">N</span></div>' +
      '      <div class="cm-lever"><div class="cm-zone" id="cm-zone"></div><div class="cm-knob" id="cm-knob"><i></i></div></div>' +
      '      <div class="cm-nudge"><button id="cm-up">▲</button><button id="cm-down">▼</button></div>' +
      '    </div>' +
      '    <div class="cm-inst panel">' +
      '      <div class="cm-dial"><div class="cm-num" id="cm-spd">0</div><span>km/h</span><i id="cm-needle"></i></div>' +
      '      <div class="cm-metrics">' +
      '        <div><small>限速</small><b><span id="cm-limit">80</span><em> km/h</em></b></div>' +
      '        <div><small>距停车标</small><b id="cm-tostop">—</b></div>' +
      '        <div><small>制动缸</small><b><span id="cm-bc">0</span><em> kPa</em></b></div>' +
      '        <div><small>加速度</small><b><span id="cm-acc">0.00</span><em> m/s²</em></b></div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="cm-act panel">' +
      '      <div class="cm-ptitle"><b>车门 / 行车</b><span id="cm-side">右侧开门</span></div>' +
      '      <div class="cm-agrid">' +
      '        <button id="cm-door-open"><b>开门</b><small>OPEN</small></button>' +
      '        <button id="cm-door-close"><b>关门</b><small>CLOSE</small></button>' +
      '        <button class="ac" id="cm-depart"><b>发车确认</b><small>DEPART</small></button>' +
      '        <button class="dz" id="cm-eb"><b>紧急制动</b><small>EB</small></button>' +
      '        <button id="cm-rel"><b>缓解 EB</b><small>RELEASE</small></button>' +
      '        <button id="cm-horn"><b>鸣笛</b><small>HORN</small></button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '  <div class="cm-toast" id="cm-toast"></div>' +
      '  <div class="cm-hint" id="cm-hint"></div>' +
      '</div>';

    var self = this;
    function $(id) { return document.getElementById(id); }
    this.$ = $;
    $("cm-up").onclick = function () { self.bump(1); };
    $("cm-down").onclick = function () { self.bump(-1); };
    $("cm-pause").onclick = function () { self.togglePause(); };
    $("cm-door-open").onclick = function () { self.door("open"); };
    $("cm-door-close").onclick = function () { self.door("close"); };
    $("cm-depart").onclick = function () { self.depart(); };
    $("cm-eb").onclick = function () { self.setNotch(-7, true); };
    $("cm-rel").onclick = function () { if (self.notch === -7) self.setNotch(0); };
    $("cm-horn").onclick = function () { beep(520, 220, "square"); };

    document.addEventListener("keydown", this._keyHandler = function (e) {
      if (!self.running) return;
      switch (e.key) {
        case "ArrowUp": self.bump(1); e.preventDefault(); break;
        case "ArrowDown": self.bump(-1); e.preventDefault(); break;
        case " ": self.togglePause(); e.preventDefault(); break;
        case "d": case "D": self.depart(); break;
        case "o": case "O": self.door("open"); break;
        case "c": case "C": self.door("close"); break;
        case "e": case "E": self.setNotch(-7, true); break;
        case "r": case "R": if (self.notch === -7) self.setNotch(0); break;
        case "h": case "H": case "Enter": beep(520, 220, "square"); break;
      }
    });

    // 画布尺寸
    this.fwd = $("cm-fwd"); this.fctx = this.fwd.getContext("2d");
    this.top = $("cm-top"); this.tctx = this.top.getContext("2d");
    this.resize();
    window.addEventListener("resize", this._rs = function () { self.resize(); });
  };

  Sim.prototype.resize = function () {
    var w = this.mount.clientWidth || 360;
    this.fwd.width = w; this.fwd.height = Math.round(w * 0.34);
    this.top.width = w; this.top.height = Math.round(w * 0.16);
  };

  Sim.prototype.announceStart = function () {
    var s0 = this.stations[this.segIndex], s1 = this.stations[this.segIndex + 1];
    announce("欢迎乘坐" + this.city + "地铁" + this.lineName + "，本次由" + s0 + "站始发");
    this.setAnn("欢迎乘坐 " + this.city + "地铁" + this.lineName, s0 + " 站始发");
  };

  Sim.prototype.updateSelectInfo = function () {
    var self = this;
    this.$("cm-ledline").textContent = this.lineName;
    this.$("cm-ledline").style.background = this.color;
    this.updateNext();
  };

  Sim.prototype.updateNext = function () {
    var ni = this.segIndex + 1;
    var name = ni <= this.targetIdx ? this.stations[ni] : "终点";
    this.$("cm-next").textContent = name;
    var side = (ni % 2 === 0) ? "右侧开门" : "左侧开门";
    this.$("cm-door").textContent = side;
    this.$("cm-side").textContent = side;
  };

  Sim.prototype.setAnn = function (zh, sub) {
    this.$("cm-ann-zh").textContent = zh;
  };

  Sim.prototype.setHint = function (msg) {
    var h = this.$("cm-hint"); if (h) h.textContent = msg;
  };

  Sim.prototype.setNotch = function (n, force) {
    if (this.phase === "done") return;
    this.notch = clamp(n, -7, 4);
    var labels = { "-7": "EB", "-6": "B7", "-5": "B6", "-4": "B5", "-3": "B4", "-2": "B3", "-1": "B2", "0": "N", "1": "P1", "2": "P2", "3": "P3", "4": "P4" };
    this.$("cm-hstate").textContent = labels[String(this.notch)];
    // 手柄视觉
    var knob = this.$("cm-knob");
    var pct = (4 - this.notch) / 11 * 100;
    knob.style.top = pct + "%";
    var zone = this.$("cm-zone");
    zone.style.background = this.notch > 0 ? "linear-gradient(#2ecc71,#27ae60)" : (this.notch < 0 ? "linear-gradient(#e74c3c,#c0392b)" : "#555");
  };

  Sim.prototype.bump = function (d) {
    if (this.phase === "docked" && this.notch !== 0 && this.v === 0 && d > 0) { /* reposition ignore */ }
    this.setNotch(this.notch + d);
  };

  Sim.prototype.togglePause = function () {
    this.paused = !this.paused;
    this.$("cm-pause").textContent = this.paused ? "▶" : "Ⅱ";
    this.setAnn(this.paused ? "运行暂停" : "继续运行");
  };

  Sim.prototype.door = function (act) {
    if (this.phase !== "docked") { this.toast("未对标停车，无法开门"); return; }
    if (act === "open") { this.doorsOpen = true; beep(660, 120); this.toast("车门已开 · 请监视站台"); announce("车门开启，" + this.stations[this.segIndex + 1] + "站到了"); }
    else { this.doorsOpen = false; beep(440, 120); this.toast("车门关闭"); }
  };

  Sim.prototype.depart = function () {
    if (this.phase !== "docked") { this.toast("请先对标停车并开门"); return; }
    if (!this.doorsOpen) { this.toast("请先开门再发车"); return; }
    this.door("close");
    // 进入下一段
    this.segIndex++;
    this.pos = 0;
    this.doorsOpen = false;
    this.phase = "run";
    this.setNotch(1);
    this.updateNext();
    var nx = this.stations[this.segIndex + 1];
    if (this.segIndex >= this.targetIdx) { this.finish(); return; }
    announce("列车始发，" + this.stations[this.segIndex] + "站，前方到站" + nx + "站");
    this.setAnn("列车始发 · " + this.stations[this.segIndex] + "站", "");
  };

  Sim.prototype.toast = function (msg) {
    var t = this.$("cm-toast"); t.textContent = msg; t.classList.add("show");
    var self = this; clearTimeout(this._tt); this._tt = setTimeout(function () { t.classList.remove("show"); }, 1600);
  };

  // ---- 物理与判分 ----
  Sim.prototype.step = function (dt) {
    if (this.phase !== "run") {
      if (this.phase === "docked") { /* 停稳等待 */ }
      setHum(this.v * 3.6);
      return;
    }
    var limit = 80; // km/h
    var limitMs = limit * 1000 / 3600;
    var a = 0;
    if (this.notch > 0) { a = this.notch * 0.42; }
    else if (this.notch < 0 && this.notch > -7) { a = this.notch * 0.34; }
    else if (this.notch === -7) { a = -3.2; }
    else { a = -0.06; } // N 位惰行阻力
    a -= 0.04 * this.v; // 空气/滚动阻力

    // 半自动 / 全自动：临近停车标自动接管制动
    if (this.mode !== "manual") {
      var toStop = this.seg - this.pos;
      var needBrake = (this.v * this.v) / (2 * Math.max(0.1, toStop));
      if (this.mode === "auto") {
        this.autoDrive(toStop, limitMs);
      } else if (this.mode === "semi" && toStop < 70) {
        this.autoDrive(toStop, limitMs);
      }
    }

    // ATP 超速保护
    if (this.v > limitMs) { this.v = limitMs; if (this.notch > 0) this.setNotch(Math.max(0, this.notch - 1)); }

    this.v += a * dt;
    if (this.v < 0) this.v = 0;
    this.accel = a;
    this.pos += this.v * dt;

    // 制动缸压力（模拟）
    if (this.notch < 0) this.bc = clamp(60 + (-this.notch) * 55, 0, 480);
    else if (this.notch === -7) this.bc = 500;
    else if (this.notch === 0) this.bc = clamp(this.bc - 80 * dt, 0, 480);
    else this.bc = clamp(this.bc - 200 * dt, 0, 480);

    if (this.v > this.maxOver) this.maxOver = this.v;

    // 到站判定
    if (this.pos >= this.seg) {
      var err = this.pos - this.seg; // 正=冲过停车标，负=未到
      this.pos = this.seg;
      this.v = 0;
      this.dock(err);
    }

    // 接近播报
    var remain = this.seg - this.pos;
    if (remain < 250 && !this._annNear && this.segIndex + 1 <= this.targetIdx) {
      this._annNear = true;
      var ns = this.stations[this.segIndex + 1];
      announce("前方到站，" + ns + "站");
      this.setAnn("前方到站 · " + ns + "站");
    }
    if (remain > 300) this._annNear = false;

    setHum(this.v * 3.6);
  };

  Sim.prototype.autoDrive = function (toStop, limitMs) {
    // 依据到停车标距离自动选择级位：保证平稳停准
    var v = this.v;
    var stopDist = (v * v) / (2 * 0.9); // 用约0.9m/s²舒适制动
    if (stopDist > toStop + 4) {
      // 需要更大制动
      var ratio = stopDist / Math.max(1, toStop);
      var n = clamp(Math.ceil(ratio * 3), 1, 7);
      this.setNotch(-n);
    } else if (v > limitMs - 0.5) {
      this.setNotch(0);
    } else if (toStop > 250) {
      this.setNotch(2);
    } else if (toStop > 60) {
      this.setNotch(1);
    } else {
      // 蠕行进站
      this.setNotch(v > 1 ? -2 : 1);
    }
  };

  Sim.prototype.dock = function (err) {
    this.phase = "docked";
    this.v = 0;
    this.setNotch(0);
    this._annNear = false;
    var stationName = this.stations[this.segIndex + 1];
    // 判分
    var ae = Math.abs(err);
    var score = 0;
    if (ae <= 0.5) score = 100;
    else if (ae <= 1) score = 92;
    else if (ae <= 2) score = 82;
    else if (ae <= 4) score = 70;
    else if (ae <= 8) score = 55;
    else score = Math.max(20, 50 - ae * 3);
    score = Math.round(score - this.smoothPenalty);
    score = clamp(score, 0, 100);
    this.scoreList.push({ station: stationName, err: err, score: score });
    this.smoothPenalty = 0;

    var side = ((this.segIndex + 1) % 2 === 0) ? "右侧" : "左侧";
    announce(stationName + "站到了，" + side + "开门");
    this.setAnn(stationName + " 站到了", "误差 " + (err >= 0 ? "+" : "") + err.toFixed(2) + " m · 得分 " + score);
    this.toast(stationName + " 到站 · 误差 " + (err >= 0 ? "+" : "") + err.toFixed(2) + " m");
    this.doorsOpen = false;
    this.updateNext();

    if (this.segIndex + 1 >= this.targetIdx) {
      // 终点站
      this.finish();
    } else {
      this.toast("对标停车完成，可开门候车后发车");
    }
  };

  Sim.prototype.finish = function () {
    this.phase = "done";
    this.running = false;
    stopEngineHum();
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    var sum = 0, best = 100, worst = 100;
    this.scoreList.forEach(function (s) { sum += s.score; if (s.score > best) best = s.score; if (s.score < worst) worst = s.score; });
    var avg = this.scoreList.length ? Math.round(sum / this.scoreList.length) : 0;
    var grade = avg >= 95 ? "S" : avg >= 88 ? "A" : avg >= 78 ? "B" : avg >= 65 ? "C" : "D";
    var html = '<div class="cm-result">' +
      '<div class="cm-eyebrow">RUN COMPLETE</div>' +
      '<div class="cm-score">' + avg + '</div>' +
      '<div class="cm-grade">' + grade + '</div>' +
      '<p class="cm-sub">' + this.city + ' · ' + this.lineName + ' · ' + (this.mode === "auto" ? "全自动" : this.mode === "semi" ? "半自动" : "人工驾驶") + ' · 共 ' + this.scoreList.length + ' 站</p>' +
      '<div class="cm-reslist">';
    this.scoreList.forEach(function (s, i) {
      var cls = s.score >= 90 ? "g" : s.score >= 70 ? "y" : "r";
      html += '<div class="cm-row"><span class="cm-idx">' + (i + 1) + '</span><b>' + s.station + '</b><span class="cm-er">误差 ' + (s.err >= 0 ? "+" : "") + s.err.toFixed(2) + 'm</span><span class="cm-pts ' + cls + '">' + s.score + '</span></div>';
    });
    html += '</div>' +
      '<div class="cm-raction">' +
      '<button class="cm-btn" id="cm-again">再跑一次</button>' +
      '<button class="cm-btn" id="cm-back">返回选线</button>' +
      '</div></div>';
    this.mount.innerHTML = html;
    var self = this;
    document.getElementById("cm-again").onclick = function () { self.start(self.cfg); };
    document.getElementById("cm-back").onclick = function () { self.onExit(); };
    document.removeEventListener("keydown", self._keyHandler);
    window.removeEventListener("resize", self._rs);
    announce("本次驾驶结束，平均成绩" + avg + "分，评级" + grade);
  };

  // ---- 渲染 ----
  Sim.prototype.render = function () {
    this.$("cm-spd").textContent = Math.round(this.v * 3.6);
    this.$("cm-limit").textContent = 80;
    this.$("cm-tostop").textContent = (this.seg - this.pos).toFixed(0) + " m";
    this.$("cm-bc").textContent = Math.round(this.bc);
    this.$("cm-acc").textContent = this.accel.toFixed(2);
    this.$("cm-dist").textContent = (this.seg - this.pos).toFixed(0) + " m";

    // 前瞻视角
    var w = this.fwd.width, h = this.fwd.height, ctx = this.fctx;
    ctx.clearRect(0, 0, w, h);
    var g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#0b1020"); g.addColorStop(1, "#161d33");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // 隧道灯带
    var off = (this.pos * 0.06) % 60;
    ctx.fillStyle = "rgba(120,160,255,0.16)";
    for (var x = -off; x < w; x += 60) { ctx.fillRect(x, 8, 26, 6); }
    // 轨枕
    ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 2;
    var y = h * 0.72;
    ctx.beginPath();
    for (var sx = -((this.pos * 0.12) % 40); sx < w; sx += 40) { ctx.moveTo(sx, y); ctx.lineTo(sx + 14, y); }
    ctx.stroke();
    // 地平线
    ctx.fillStyle = "#0e1530"; ctx.fillRect(0, y + 4, w, h - y);
    // 接近站牌
    var remain = this.seg - this.pos;
    if (remain < 700) {
      var ap = clamp(1 - remain / 700, 0, 1);
      ctx.fillStyle = "rgba(255,210,90," + (0.25 + ap * 0.5) + ")";
      var bw = 120 * ap + 20;
      ctx.fillRect(w / 2 - bw / 2, h * 0.30, bw, 26 * ap + 6);
      ctx.fillStyle = "#1a1206"; ctx.font = "bold " + Math.round(14 * ap + 6) + "px sans-serif"; ctx.textAlign = "center";
      if (ap > 0.4) ctx.fillText(this.stations[this.segIndex + 1], w / 2, h * 0.30 + 18 * ap + 6);
    }

    // 俯视对位
    var tw = this.top.width, th = this.top.height, t = this.tctx;
    t.clearRect(0, 0, tw, th);
    t.fillStyle = "#0c1226"; t.fillRect(0, 0, tw, th);
    // 停车区（绿带居中）
    var zx = tw * 0.5, zw = tw * 0.10;
    t.fillStyle = "rgba(46,204,113,0.30)"; t.fillRect(zx - zw / 2, 4, zw, th - 8);
    t.strokeStyle = "rgba(46,204,113,0.9)"; t.lineWidth = 2; t.strokeRect(zx - zw / 2, 4, zw, th - 8);
    // 车头位置：由 (pos/seg) 映射到 [0,1] -> 屏幕
    var trainFrac = clamp(this.pos / this.seg, 0, 1);
    var headX = lerp(tw * 0.12, tw * 0.88, trainFrac);
    t.fillStyle = this.color; t.fillRect(headX - 9, th / 2 - 5, 18, 10);
    t.fillStyle = "#fff"; t.font = "10px sans-serif"; t.textAlign = "center";
    t.fillText("车头", headX, th / 2 + 18);
    // 预计停车
    var stopDist = this.v > 0.1 ? (this.v * this.v) / (2 * 0.9) : 0;
    var predPos = clamp(this.pos + stopDist, 0, this.seg);
    var predX = lerp(tw * 0.12, tw * 0.88, predPos / this.seg);
    t.fillStyle = "rgba(255,160,40,0.9)"; t.fillRect(predX - 3, 4, 6, th - 8);
    t.fillStyle = "#ffb13c"; t.fillText("预计", predX, 14);
    // 目标停车标
    t.fillStyle = "#fff"; t.fillRect(zx - 1, 4, 2, th - 8);

    // 指针
    var needle = this.$("cm-needle");
    if (needle) { var ang = clamp(this.v * 3.6 / 80, 0, 1) * 220 - 110; needle.style.transform = "rotate(" + ang + "deg)"; }
  };

  Sim.prototype.destroy = function () {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    stopEngineHum();
    document.removeEventListener("keydown", this._keyHandler);
    window.removeEventListener("resize", this._rs);
  };

  window.ChinaMetroSim = Sim;
  window.METRO_SIM_TOKEN = _t;
})();
