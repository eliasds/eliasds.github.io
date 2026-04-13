/**
 * Web beta — mirrors dicotic iOS: per-channel Balance (pan -1..1), separate volumes,
 * swap queues (exchange tracks; pans stay with Left/Right columns), dual play.
 * @see dicotic: services/audioQueue.ts (leftPan/rightPan), components/PanSlider.tsx
 */

(function () {
  "use strict";

  /** @type {HTMLAudioElement | null} */
  const audioLeft = document.getElementById("beta-audio-left");
  /** @type {HTMLAudioElement | null} */
  const audioRight = document.getElementById("beta-audio-right");
  const statusEl = document.getElementById("beta-status");
  const masterVolumeEl = document.getElementById("beta-master-volume");
  const dualPlayBtn = document.getElementById("beta-dual-play");
  const swapBtn = document.getElementById("beta-swap-queues");

  if (!audioLeft || !audioRight) return;

  /** Sticky midpoint — PanSlider.tsx CENTER_SNAP_THRESHOLD */
  var CENTER_SNAP = 0.08;
  var SEEK_STEP = 15;

  var trackMeta = [{ title: "No track loaded" }, { title: "No track loaded" }];

  /** @type {AudioContext | null} */
  var ctx = null;
  /** @type {GainNode | null} */
  var masterGain = null;
  /** @type {GainNode[]} */
  var trackGains = [];
  /** @type {StereoPannerNode[]} */
  var panners = [];

  var audios = [audioLeft, audioRight];

  var ui = {
    left: {
      title: document.getElementById("beta-title-left"),
      loadBtn: document.getElementById("beta-load-left"),
      fileInput: document.getElementById("beta-file-left"),
      playBtn: document.getElementById("beta-play-left"),
      seek: document.getElementById("beta-seek-left"),
      timeEl: document.getElementById("beta-time-el-left"),
      timeDur: document.getElementById("beta-time-dur-left"),
      vol: document.getElementById("beta-vol-left"),
      pan: document.getElementById("beta-pan-left"),
      prev: document.getElementById("beta-prev-left"),
      next: document.getElementById("beta-next-left"),
      queue: document.getElementById("beta-queue-left"),
    },
    right: {
      title: document.getElementById("beta-title-right"),
      loadBtn: document.getElementById("beta-load-right"),
      fileInput: document.getElementById("beta-file-right"),
      playBtn: document.getElementById("beta-play-right"),
      seek: document.getElementById("beta-seek-right"),
      timeEl: document.getElementById("beta-time-el-right"),
      timeDur: document.getElementById("beta-time-dur-right"),
      vol: document.getElementById("beta-vol-right"),
      pan: document.getElementById("beta-pan-right"),
      prev: document.getElementById("beta-prev-right"),
      next: document.getElementById("beta-next-right"),
      queue: document.getElementById("beta-queue-right"),
    },
  };

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.hidden = !msg;
    statusEl.classList.toggle("beta-status--error", !!isError);
  }

  function clampPan(p) {
    return Math.max(-1, Math.min(1, p));
  }

  function applyCenterSnap(raw) {
    var c = clampPan(raw);
    if (Math.abs(c) <= CENTER_SNAP) return 0;
    return c;
  }

  function setPanInputValue(input, value) {
    if (!input) return;
    var v = applyCenterSnap(parseFloat(String(value)));
    input.value = String(v);
    input.setAttribute("aria-valuenow", String(v));
  }

  function renderTitles() {
    if (ui.left.title) {
      ui.left.title.textContent = trackMeta[0].title;
      ui.left.title.classList.toggle("beta-now-playing--muted", trackMeta[0].title === "No track loaded");
    }
    if (ui.right.title) {
      ui.right.title.textContent = trackMeta[1].title;
      ui.right.title.classList.toggle("beta-now-playing--muted", trackMeta[1].title === "No track loaded");
    }
  }

  function applyPansToGraph() {
    if (panners.length < 2) return;
    var pl = ui.left.pan ? parseFloat(ui.left.pan.value) : -1;
    var pr = ui.right.pan ? parseFloat(ui.right.pan.value) : 1;
    panners[0].pan.value = Number.isFinite(pl) ? clampPan(pl) : -1;
    panners[1].pan.value = Number.isFinite(pr) ? clampPan(pr) : 1;
  }

  /**
   * Browsers start AudioContext suspended; resume() only succeeds from a user gesture.
   * createMediaElementSource() sends output only through the graph — if the context stays
   * suspended, playback is silent. Always resume when the graph already exists.
   */
  function resumeAudioContextIfNeeded() {
    if (!ctx) return Promise.resolve(null);
    if (ctx.state === "suspended") {
      return ctx.resume().then(function () {
        return ctx;
      }).catch(function () {
        return ctx;
      });
    }
    return Promise.resolve(ctx);
  }

  function ensureGraph() {
    if (ctx) {
      applyPansToGraph();
      return resumeAudioContextIfNeeded();
    }

    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      setStatus("Web Audio is not supported in this browser.", true);
      return Promise.reject(new Error("No AudioContext"));
    }

    ctx = new AC();
    masterGain = ctx.createGain();
    var mv = masterVolumeEl ? parseFloat(masterVolumeEl.value) : 0.85;
    masterGain.gain.value = Number.isFinite(mv) ? mv : 0.85;
    masterGain.connect(ctx.destination);

    for (var i = 0; i < 2; i++) {
      var g = ctx.createGain();
      var volEl = i === 0 ? ui.left.vol : ui.right.vol;
      var iv = volEl ? parseFloat(volEl.value) : 1;
      g.gain.value = Number.isFinite(iv) ? iv : 1;
      var panner = ctx.createStereoPanner();
      var src = ctx.createMediaElementSource(audios[i]);
      src.connect(g);
      g.connect(panner);
      panner.connect(masterGain);
      trackGains.push(g);
      panners.push(panner);
    }

    setPanInputValue(ui.left.pan, ui.left.pan ? ui.left.pan.value : -1);
    setPanInputValue(ui.right.pan, ui.right.pan ? ui.right.pan.value : 1);
    applyPansToGraph();

    return resumeAudioContextIfNeeded();
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function updateSeekUi() {
    ["left", "right"].forEach(function (side) {
      var idx = side === "left" ? 0 : 1;
      var el = audios[idx];
      var u = ui[side];
      if (!u.seek || !u.timeEl || !u.timeDur || !el) return;
      var d = el.duration;
      u.seek.max = Number.isFinite(d) && d > 0 ? d : 0;
      if (!u.seek.dataset.dragging) u.seek.value = String(el.currentTime || 0);
      u.timeEl.textContent = formatTime(el.currentTime);
      u.timeDur.textContent = formatTime(Number.isFinite(d) ? d : 0);
    });
  }

  function loopSeek() {
    updateSeekUi();
    requestAnimationFrame(loopSeek);
  }

  /** Ionicons 7 — play.svg / pause.svg */
  function channelPlayIcon(isPlaying) {
    return isPlaying
      ? '<path fill="currentColor" d="M208 432h-48a16 16 0 01-16-16V96a16 16 0 0116-16h48a16 16 0 0116 16v320a16 16 0 01-16 16zM352 432h-48a16 16 0 01-16-16V96a16 16 0 0116-16h48a16 16 0 0116 16v320a16 16 0 01-16 16z"/>'
      : '<path fill="currentColor" d="M133 440a35.37 35.37 0 01-17.5-4.67c-12-6.8-19.46-20-19.46-34.33V111c0-14.37 7.46-27.53 19.46-34.33a35.13 35.13 0 0135.77.45l247.85 148.36a36 36 0 010 61l-247.89 148.4A35.5 35.5 0 01133 440z"/>';
  }

  function updatePlayLabels() {
    ["left", "right"].forEach(function (side) {
      var idx = side === "left" ? 0 : 1;
      var u = ui[side];
      var a = audios[idx];
      if (u.playBtn && a) {
        var playing = !a.paused;
        u.playBtn.innerHTML =
          '<svg class="ionicon" width="52" height="52" viewBox="0 0 512 512" aria-hidden="true">' +
          channelPlayIcon(playing) +
          "</svg>";
        u.playBtn.setAttribute("aria-label", playing ? "Pause " + side + " channel" : "Play " + side + " channel");
      }
    });

    if (dualPlayBtn) {
      var bothPlaying = !audioLeft.paused && !audioRight.paused;
      dualPlayBtn.innerHTML =
        '<svg class="ionicon" width="72" height="72" viewBox="0 0 512 512" aria-hidden="true">' +
        channelPlayIcon(bothPlaying) +
        "</svg>";
      dualPlayBtn.setAttribute("aria-label", bothPlaying ? "Pause both channels" : "Play both channels");
    }
  }

  function wireChannel(side) {
    var u = ui[side];
    var idx = side === "left" ? 0 : 1;

    if (u.loadBtn && u.fileInput) {
      u.loadBtn.addEventListener("click", function () {
        u.fileInput.click();
      });
      u.fileInput.addEventListener("change", function () {
        var f = u.fileInput.files && u.fileInput.files[0];
        if (!f) return;
        ensureGraph()
          .then(function () {
            var a = audios[idx];
            var prev = a.src;
            if (prev && prev.indexOf("blob:") === 0) URL.revokeObjectURL(prev);
            a.src = URL.createObjectURL(f);
            trackMeta[idx].title = f.name || "Local file";
            renderTitles();
            setStatus("");
            return a.play().catch(function () {
              setStatus("Could not start playback. Tap play after loading.", true);
            });
          })
          .catch(function () {});
      });
    }

    if (u.playBtn) {
      u.playBtn.addEventListener("click", function () {
        ensureGraph()
          .then(function () {
            var a = audios[idx];
            if (a.paused) {
              return a.play().catch(function () {
                setStatus("Playback blocked until you interact with the page.", true);
              });
            }
            a.pause();
          })
          .catch(function () {});
      });
    }

    if (u.seek) {
      u.seek.addEventListener("pointerdown", function () {
        u.seek.dataset.dragging = "1";
      });
      u.seek.addEventListener("pointerup", function () {
        delete u.seek.dataset.dragging;
      });
      u.seek.addEventListener("input", function () {
        ensureGraph()
          .then(function () {
            var a = audios[idx];
            var v = parseFloat(u.seek.value);
            if (Number.isFinite(v)) a.currentTime = v;
          })
          .catch(function () {});
      });
    }

    if (u.vol) {
      u.vol.addEventListener("input", function () {
        ensureGraph()
          .then(function () {
            var g = trackGains[idx];
            if (!g) return;
            var v = parseFloat(u.vol.value);
            g.gain.value = Number.isFinite(v) ? v : 1;
          })
          .catch(function () {});
      });
    }

    if (u.pan) {
      u.pan.addEventListener("input", function () {
        var raw = parseFloat(u.pan.value);
        var snapped = applyCenterSnap(raw);
        if (snapped !== raw) setPanInputValue(u.pan, snapped);
        ensureGraph()
          .then(function () {
            applyPansToGraph();
          })
          .catch(function () {});
      });
    }

    if (u.prev) {
      u.prev.addEventListener("click", function () {
        var a = audios[idx];
        a.currentTime = Math.max(0, a.currentTime - SEEK_STEP);
      });
    }
    if (u.next) {
      u.next.addEventListener("click", function () {
        var a = audios[idx];
        var d = a.duration;
        var maxT = Number.isFinite(d) && d > 0 ? d : a.currentTime + SEEK_STEP;
        a.currentTime = Math.min(maxT, a.currentTime + SEEK_STEP);
      });
    }

    if (u.queue) {
      u.queue.addEventListener("click", function () {
        setStatus("Queue management is not available in the web beta yet.", false);
        setTimeout(function () {
          if (statusEl && statusEl.textContent.indexOf("Queue management") !== -1) statusEl.hidden = true;
        }, 3200);
      });
    }
  }

  wireChannel("left");
  wireChannel("right");

  audios.forEach(function (a) {
    a.addEventListener("play", function () {
      ensureGraph()
        .then(function () {
          updatePlayLabels();
        })
        .catch(function () {});
    });
    a.addEventListener("pause", updatePlayLabels);
    a.addEventListener("ended", updatePlayLabels);
  });

  if (masterVolumeEl) {
    masterVolumeEl.addEventListener("input", function () {
      var v = parseFloat(masterVolumeEl.value);
      if (masterGain) masterGain.gain.value = Number.isFinite(v) ? v : 0.85;
    });
  }

  if (dualPlayBtn) {
    dualPlayBtn.addEventListener("click", function () {
      ensureGraph()
        .then(function () {
          var bothPlaying = !audioLeft.paused && !audioRight.paused;
          if (bothPlaying) {
            audioLeft.pause();
            audioRight.pause();
          } else {
            return Promise.all([audioLeft.play(), audioRight.play()]).catch(function () {
              setStatus("Playback blocked or no audio loaded.", true);
            });
          }
        })
        .catch(function () {});
    });
  }

  function swapQueues() {
    var al = audioLeft;
    var ar = audioRight;
    var srcL = al.src;
    var srcR = ar.src;
    var metaL = trackMeta[0];
    var metaR = trackMeta[1];
    var tL = al.currentTime;
    var tR = ar.currentTime;
    var pausedL = al.paused;
    var pausedR = ar.paused;

    al.pause();
    ar.pause();

    al.src = srcR || "";
    ar.src = srcL || "";
    trackMeta[0] = metaR;
    trackMeta[1] = metaL;

    function finish() {
      if (al.src) {
        try {
          al.currentTime = tR;
        } catch (e) {}
      }
      if (ar.src) {
        try {
          ar.currentTime = tL;
        } catch (e) {}
      }
      renderTitles();
      updatePlayLabels();
      updateSeekUi();
      if (!pausedR && srcR) al.play().catch(function () {});
      if (!pausedL && srcL) ar.play().catch(function () {});
    }

    var pending = 0;
    function onReady() {
      pending--;
      if (pending <= 0) finish();
    }
    if (srcR) {
      pending++;
      al.addEventListener("loadeddata", onReady, { once: true });
    }
    if (srcL) {
      pending++;
      ar.addEventListener("loadeddata", onReady, { once: true });
    }
    if (pending === 0) finish();
  }

  if (swapBtn) {
    swapBtn.addEventListener("click", function () {
      ensureGraph()
        .then(function () {
          swapQueues();
        })
        .catch(function () {});
    });
  }

  requestAnimationFrame(loopSeek);
  renderTitles();
  updatePlayLabels();

  window.dicoticBeta = { ensureGraph: ensureGraph, swapQueues: swapQueues };
})();
