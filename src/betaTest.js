/**
 * Web beta — mirrors dicotic iOS: per-channel Balance (pan -1..1), separate volumes,
 * swap queues (exchange tracks; pans stay with Left/Right columns), dual play,
 * queue sheet / drawer, shuffle, repeat, drag reorder, per-row delete.
 * @see dicotic: services/audioQueue.ts, components/QueueSheet.tsx
 */

(function () {
  "use strict";

  /** @type {HTMLAudioElement | null} */
  const audioLeft = document.getElementById("beta-audio-left");
  /** @type {HTMLAudioElement | null} */
  const audioRight = document.getElementById("beta-audio-right");
  const statusEl = document.getElementById("beta-status");
  const dualPlayBtn = document.getElementById("beta-dual-play");
  const swapBtn = document.getElementById("beta-swap-queues");

  const queueRoot = document.getElementById("beta-queue-root");
  const queueBackdrop = document.getElementById("beta-queue-backdrop");
  const queuePanel = document.getElementById("beta-queue-panel");
  const queueHeading = document.getElementById("beta-queue-heading");
  const queueListEl = document.getElementById("beta-queue-list");
  const queueShuffleBtn = document.getElementById("beta-queue-shuffle");
  const queueRepeatBtn = document.getElementById("beta-queue-repeat");
  const queueCloseBtn = document.getElementById("beta-queue-close");
  const queueClearBtn = document.getElementById("beta-queue-clear");
  const queueEmptyEl = document.getElementById("beta-queue-empty");

  if (!audioLeft || !audioRight) return;

  /** Sticky midpoint — PanSlider.tsx CENTER_SNAP_THRESHOLD */
  var CENTER_SNAP = 0.08;
  var SEEK_STEP = 15;

  /** @typedef {'left'|'right'} ChannelSide */
  /** @typedef {'off'|'queue'|'one'} RepeatMode */

  var trackMeta = [
    { title: "No track loaded", artist: "" },
    { title: "No track loaded", artist: "" },
  ];

  /** @type {File[][]} Full queue per channel (dicotic leftQueue/rightQueue). */
  var channelQueueFiles = [[], []];
  /** @type {number[]} Current playback index into channelQueueFiles. */
  var channelCurrentIndex = [0, 0];
  /** @type {boolean[]} */
  var channelShuffleEnabled = [false, false];
  /** @type {(File[]|null)[]} Snapshot before shuffle (restore on toggle off). */
  var channelShuffleSnapshot = [null, null];
  /** @type {RepeatMode[]} */
  var channelRepeatMode = /** @type {RepeatMode[]} */ (["off", "off"]);
  /** Last blob: URL string per channel for revoke (parallel to audio.src when blob). */
  var channelLastBlobUrl = ["", ""];

  /** Which channel queue UI is showing, or null if closed. */
  var queuePanelChannel = /** @type {ChannelSide | null} */ (null);

  /** Linear gain when Boost is on (per channel); off = 1 */
  var BOOST_GAIN_ON = 1.55;
  var speedPresets = [0.75, 1, 1.25, 1.5];
  var speedIdx = [1, 1];

  /** @type {AudioContext | null} */
  var ctx = null;
  /** @type {GainNode | null} */
  var masterGain = null;
  /** @type {GainNode[]} */
  var trackGains = [];
  /** @type {GainNode[]} */
  var boostGains = [];
  /** @type {StereoPannerNode[]} */
  var panners = [];
  /** @type {boolean[]} */
  var boostOn = [false, false];

  var audios = [audioLeft, audioRight];

  var ui = {
    left: {
      title: document.getElementById("beta-title-left"),
      artist: document.getElementById("beta-artist-left"),
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
      boost: document.getElementById("beta-boost-left"),
      speed: document.getElementById("beta-speed-left"),
      speedLabel: document.querySelector("#beta-speed-left .beta-speed-label"),
    },
    right: {
      title: document.getElementById("beta-title-right"),
      artist: document.getElementById("beta-artist-right"),
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
      boost: document.getElementById("beta-boost-right"),
      speed: document.getElementById("beta-speed-right"),
      speedLabel: document.querySelector("#beta-speed-right .beta-speed-label"),
    },
  };

  function sideToIdx(side) {
    return side === "left" ? 0 : 1;
  }

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

  function formatSpeedLabel(rate) {
    var s = String(rate);
    if (s.indexOf(".") === -1) return s + "×";
    return s.replace(/\.?0+$/, "") + "×";
  }

  function renderSpeedLabels() {
    ["left", "right"].forEach(function (side) {
      var idx = side === "left" ? 0 : 1;
      var u = ui[side];
      var rate = speedPresets[speedIdx[idx]] || 1;
      if (u.speedLabel) u.speedLabel.textContent = formatSpeedLabel(rate);
      if (u.speed) {
        u.speed.setAttribute("aria-label", (side === "left" ? "Left" : "Right") + " playback speed " + formatSpeedLabel(rate));
      }
    });
  }

  function renderTitles() {
    if (ui.left.title) {
      ui.left.title.textContent = trackMeta[0].title;
      ui.left.title.classList.toggle("beta-track-title--muted", trackMeta[0].title === "No track loaded");
    }
    if (ui.left.artist) {
      var al = trackMeta[0].artist || "";
      ui.left.artist.textContent = al;
      ui.left.artist.classList.toggle("beta-track-artist--empty", !al);
    }
    if (ui.right.title) {
      ui.right.title.textContent = trackMeta[1].title;
      ui.right.title.classList.toggle("beta-track-title--muted", trackMeta[1].title === "No track loaded");
    }
    if (ui.right.artist) {
      var ar = trackMeta[1].artist || "";
      ui.right.artist.textContent = ar;
      ui.right.artist.classList.toggle("beta-track-artist--empty", !ar);
    }
  }

  function clearShuffleState(chIdx) {
    channelShuffleEnabled[chIdx] = false;
    channelShuffleSnapshot[chIdx] = null;
  }

  function revokeBlobForChannel(chIdx) {
    var prev = channelLastBlobUrl[chIdx];
    if (prev && prev.indexOf("blob:") === 0) {
      try {
        URL.revokeObjectURL(prev);
      } catch (e) {}
    }
    channelLastBlobUrl[chIdx] = "";
  }

  function getQueue(chIdx) {
    return channelQueueFiles[chIdx];
  }

  function getCurrentFile(chIdx) {
    var q = getQueue(chIdx);
    var i = channelCurrentIndex[chIdx];
    return q[i] ?? null;
  }

  /**
   * Load channelQueueFiles[chIdx][channelCurrentIndex[chIdx]] into <audio>.
   * @param {{ doPlay?: boolean, seekTo?: number }} opts
   */
  function assignAudioFromCurrentIndex(chIdx, opts) {
    opts = opts || {};
    var a = audios[chIdx];
    var f = getCurrentFile(chIdx);
    revokeBlobForChannel(chIdx);
    if (!f) {
      a.removeAttribute("src");
      a.load();
      trackMeta[chIdx] = { title: "No track loaded", artist: "" };
      renderTitles();
      updatePlayLabels();
      return Promise.resolve();
    }
    var url = URL.createObjectURL(f);
    channelLastBlobUrl[chIdx] = url;
    a.src = url;
    trackMeta[chIdx] = { title: f.name || "Local file", artist: "" };
    renderTitles();
    var seekTo = opts.seekTo;
    return new Promise(function (resolve) {
      function afterMeta() {
        a.removeEventListener("loadedmetadata", afterMeta);
        if (typeof seekTo === "number" && Number.isFinite(seekTo) && seekTo > 0) {
          try {
            a.currentTime = seekTo;
          } catch (e) {}
        }
        if (opts.doPlay) {
          a.play()
            .then(function () {
              resolve();
            })
            .catch(function () {
              setStatus("Could not start playback. Tap play after loading.", true);
              resolve();
            });
        } else {
          resolve();
        }
      }
      a.addEventListener("loadedmetadata", afterMeta, { once: true });
      a.load();
    });
  }

  function clearChannelQueue(chIdx) {
    clearShuffleState(chIdx);
    channelRepeatMode[chIdx] = "off";
    channelQueueFiles[chIdx] = [];
    channelCurrentIndex[chIdx] = 0;
    audios[chIdx].pause();
    revokeBlobForChannel(chIdx);
    audios[chIdx].removeAttribute("src");
    audios[chIdx].load();
    trackMeta[chIdx] = { title: "No track loaded", artist: "" };
    renderTitles();
    updatePlayLabels();
    refreshQueuePanelIfOpen();
  }

  function fisherYatesShuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
  }

  function toggleShuffleForChannel(chIdx) {
    var q = getQueue(chIdx);
    if (q.length <= 1) return;

    if (channelShuffleEnabled[chIdx]) {
      var snap = channelShuffleSnapshot[chIdx];
      if (!snap || snap.length === 0) {
        channelShuffleEnabled[chIdx] = false;
        channelShuffleSnapshot[chIdx] = null;
        refreshQueuePanelIfOpen();
        return;
      }
      var cur = getCurrentFile(chIdx);
      channelQueueFiles[chIdx] = snap.slice();
      channelShuffleSnapshot[chIdx] = null;
      channelShuffleEnabled[chIdx] = false;
      if (cur) {
        var ni = channelQueueFiles[chIdx].indexOf(cur);
        channelCurrentIndex[chIdx] = ni >= 0 ? ni : 0;
      }
      assignAudioFromCurrentIndex(chIdx, { doPlay: !audios[chIdx].paused }).then(function () {
        refreshQueuePanelIfOpen();
      });
      return;
    }

    var current = getCurrentFile(chIdx);
    channelShuffleSnapshot[chIdx] = q.slice();
    var shuffled = q.slice();
    fisherYatesShuffle(shuffled);
    channelQueueFiles[chIdx] = shuffled;
    channelShuffleEnabled[chIdx] = true;
    if (current) {
      var idx = shuffled.indexOf(current);
      channelCurrentIndex[chIdx] = idx >= 0 ? idx : 0;
    }
    assignAudioFromCurrentIndex(chIdx, { doPlay: !audios[chIdx].paused }).then(function () {
      refreshQueuePanelIfOpen();
    });
  }

  function toggleRepeatForChannel(chIdx) {
    var m = channelRepeatMode[chIdx];
    if (m === "off") channelRepeatMode[chIdx] = "queue";
    else if (m === "queue") channelRepeatMode[chIdx] = "one";
    else channelRepeatMode[chIdx] = "off";
    refreshQueuePanelIfOpen();
  }

  /** dicotic onTrackEnd — index + repeat (Option A). */
  function onTrackEndedForChannel(chIdx) {
    var q = getQueue(chIdx);
    var index = channelCurrentIndex[chIdx];
    var repeatMode = channelRepeatMode[chIdx];

    if (repeatMode === "one" && q.length > 0) {
      assignAudioFromCurrentIndex(chIdx, { doPlay: true, seekTo: 0 }).then(function () {
        updatePlayLabels();
        refreshQueuePanelIfOpen();
      });
      return;
    }

    if (index < q.length - 1) {
      channelCurrentIndex[chIdx] = index + 1;
      assignAudioFromCurrentIndex(chIdx, { doPlay: true }).then(function () {
        updatePlayLabels();
        refreshQueuePanelIfOpen();
      });
      return;
    }

    if (repeatMode === "queue" && q.length > 0) {
      channelCurrentIndex[chIdx] = 0;
      assignAudioFromCurrentIndex(chIdx, { doPlay: true }).then(function () {
        updatePlayLabels();
        refreshQueuePanelIfOpen();
      });
      return;
    }

    audios[chIdx].pause();
    updatePlayLabels();
    refreshQueuePanelIfOpen();
  }

  function playFromIndex(chIdx, listIndex) {
    var q = getQueue(chIdx);
    if (q.length === 0) return;
    var clamped = Math.max(0, Math.min(listIndex, q.length - 1));
    channelCurrentIndex[chIdx] = clamped;
    assignAudioFromCurrentIndex(chIdx, { doPlay: true }).then(function () {
      updatePlayLabels();
      refreshQueuePanelIfOpen();
    });
  }

  function removeQueueItemAt(chIdx, listIndex) {
    var q = getQueue(chIdx);
    if (listIndex < 0 || listIndex >= q.length) return;
    var cur = channelCurrentIndex[chIdx];
    var oldLen = q.length;
    var removedCurrent = listIndex === cur;
    q.splice(listIndex, 1);

    if (listIndex < cur) {
      channelCurrentIndex[chIdx] = cur - 1;
    } else if (listIndex === cur) {
      if (q.length === 0) {
        channelCurrentIndex[chIdx] = 0;
      } else if (listIndex < oldLen - 1) {
        channelCurrentIndex[chIdx] = listIndex;
      } else {
        channelCurrentIndex[chIdx] = q.length - 1;
      }
    }

    if (q.length === 0) {
      clearShuffleState(chIdx);
      channelRepeatMode[chIdx] = "off";
      revokeBlobForChannel(chIdx);
      audios[chIdx].removeAttribute("src");
      audios[chIdx].load();
      trackMeta[chIdx] = { title: "No track loaded", artist: "" };
    } else if (removedCurrent) {
      assignAudioFromCurrentIndex(chIdx, { doPlay: !audios[chIdx].paused });
    }
    renderTitles();
    updatePlayLabels();
    refreshQueuePanelIfOpen();
  }

  function moveQueueItem(chIdx, fromIdx, toIdx) {
    var q = getQueue(chIdx);
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= q.length || toIdx >= q.length) return;
    if (fromIdx === channelCurrentIndex[chIdx]) return;
    var curFile = getCurrentFile(chIdx);
    var item = q.splice(fromIdx, 1)[0];
    var dest = toIdx;
    if (fromIdx < toIdx) dest = toIdx - 1;
    q.splice(dest, 0, item);
    if (curFile) {
      var ni = q.indexOf(curFile);
      channelCurrentIndex[chIdx] = ni >= 0 ? ni : 0;
    }
    refreshQueuePanelIfOpen();
  }

  function updateQueueHeaderButtons(chIdx) {
    if (!queueShuffleBtn || !queueRepeatBtn) return;
    var sh = channelShuffleEnabled[chIdx];
    queueShuffleBtn.setAttribute("aria-pressed", sh ? "true" : "false");
    queueShuffleBtn.classList.toggle("beta-queue-icon--active", sh);

    var rep = channelRepeatMode[chIdx];
    queueRepeatBtn.setAttribute("aria-pressed", rep !== "off" ? "true" : "false");
    queueRepeatBtn.classList.toggle("beta-queue-icon--active", rep !== "off");
    var badge = queueRepeatBtn.querySelector(".beta-queue-repeat-badge");
    if (badge) {
      badge.hidden = rep !== "one";
    }
    queueRepeatBtn.setAttribute(
      "aria-label",
      rep === "off" ? "Repeat off" : rep === "queue" ? "Repeat queue" : "Repeat one track",
    );
  }

  function renderQueueList() {
    if (!queueListEl || !queueHeading || !queuePanelChannel) return;
    var chIdx = sideToIdx(queuePanelChannel);
    var q = getQueue(chIdx);
    var cur = channelCurrentIndex[chIdx];

    if (queueHeading) {
      queueHeading.textContent = queuePanelChannel === "left" ? "Left queue" : "Right queue";
      queueHeading.style.color = queuePanelChannel === "left" ? "var(--beta-left)" : "var(--beta-right)";
    }

    updateQueueHeaderButtons(chIdx);

    if (queueEmptyEl) {
      queueEmptyEl.hidden = q.length > 0;
    }
    queueListEl.innerHTML = "";

    for (var i = 0; i < q.length; i++) {
      (function (rowIndex) {
        var file = q[rowIndex];
        var row = document.createElement("div");
        row.className = "beta-queue-row" + (rowIndex === cur ? " beta-queue-row--current" : "");
        row.setAttribute("role", "listitem");
        row.dataset.queueIndex = String(rowIndex);

        var idxEl = document.createElement("span");
        idxEl.className = "beta-queue-row-idx";
        idxEl.textContent = String(rowIndex + 1);

        var titleBtn = document.createElement("button");
        titleBtn.type = "button";
        titleBtn.className = "beta-queue-row-title";
        titleBtn.textContent = file.name || "Track";
        titleBtn.addEventListener("click", function () {
          playFromIndex(chIdx, rowIndex);
        });

        var del = document.createElement("button");
        del.type = "button";
        del.className = "beta-queue-row-delete";
        del.setAttribute("aria-label", "Remove from queue");
        del.innerHTML =
          '<svg class="ionicon" width="20" height="20" viewBox="0 0 512 512" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M112 112l20 320c0 8 8.7 16 16.7 16h214c8 0 16.7-8 16.7-16l20-320"/><path stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32" d="M80 112h352"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M192 112V72h0a23.93 23.93 0 0124-24h80a23.93 23.93 0 0124 24h0v40M169 169l22 22M323 323l22 22M237 288l42 42m0-42l-42 42"/></svg>';
        del.addEventListener("click", function (e) {
          e.stopPropagation();
          removeQueueItemAt(chIdx, rowIndex);
        });

        var handle = document.createElement("span");
        handle.className = "beta-queue-row-handle";
        handle.setAttribute("aria-hidden", "true");
        handle.innerHTML =
          '<svg class="ionicon" width="22" height="22" viewBox="0 0 512 512"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="48" d="M80 144h352M80 256h352M80 368h352"/></svg>';

        if (rowIndex !== cur) {
          row.setAttribute("draggable", "true");
          handle.setAttribute("aria-label", "Drag to reorder");
        } else {
          row.setAttribute("draggable", "false");
        }

        row.appendChild(idxEl);
        row.appendChild(titleBtn);
        row.appendChild(del);
        row.appendChild(handle);
        queueListEl.appendChild(row);
      })(i);
    }

    wireQueueListDnD(chIdx);
  }

  var dndDragCh = -1;
  var dndFromIndex = -1;

  function wireQueueListDnD(chIdx) {
    if (!queueListEl) return;
    var rows = queueListEl.querySelectorAll(".beta-queue-row");

    rows.forEach(function (row) {
      var fromIdx = parseInt(row.dataset.queueIndex || "-1", 10);
      if (fromIdx < 0) return;

      row.addEventListener("dragstart", function (e) {
        dndDragCh = chIdx;
        dndFromIndex = fromIdx;
        row.classList.add("beta-queue-row--dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          try {
            e.dataTransfer.setData("text/plain", String(fromIdx));
          } catch (err) {}
        }
      });
      row.addEventListener("dragend", function () {
        row.classList.remove("beta-queue-row--dragging");
        dndDragCh = -1;
        dndFromIndex = -1;
        rows.forEach(function (r) {
          r.classList.remove("beta-queue-row--drop-target");
        });
      });
      row.addEventListener("dragover", function (e) {
        if (dndDragCh !== chIdx || dndFromIndex < 0) return;
        e.preventDefault();
        var targetIdx = parseInt(row.dataset.queueIndex || "-1", 10);
        if (targetIdx < 0) return;
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        row.classList.add("beta-queue-row--drop-target");
      });
      row.addEventListener("dragleave", function () {
        row.classList.remove("beta-queue-row--drop-target");
      });
      row.addEventListener("drop", function (e) {
        e.preventDefault();
        row.classList.remove("beta-queue-row--drop-target");
        if (dndDragCh !== chIdx || dndFromIndex < 0) return;
        var toIdx = parseInt(row.dataset.queueIndex || "-1", 10);
        if (toIdx < 0) return;
        moveQueueItem(chIdx, dndFromIndex, toIdx);
      });
    });
  }

  function refreshQueuePanelIfOpen() {
    if (queuePanelChannel && queueRoot && !queueRoot.hidden) {
      renderQueueList();
    }
  }

  function isQueueDrawerLayout() {
    return typeof window.matchMedia === "function" && window.matchMedia("(min-width: 900px)").matches;
  }

  /** Desktop drawer: anchor panel to left or right edge based on active channel. */
  function syncQueueDrawerSideClass() {
    if (!queuePanel || !queueRoot) return;
    queuePanel.classList.remove("beta-queue-panel--drawer-left", "beta-queue-panel--drawer-right");
    if (queueRoot.hidden || !queuePanelChannel) return;
    if (!isQueueDrawerLayout()) return;
    if (queuePanelChannel === "left") queuePanel.classList.add("beta-queue-panel--drawer-left");
    else queuePanel.classList.add("beta-queue-panel--drawer-right");
  }

  function setQueueLayoutClass() {
    if (!queueRoot) return;
    queueRoot.classList.toggle("beta-queue-root--drawer", isQueueDrawerLayout());
    syncQueueDrawerSideClass();
  }

  function openQueuePanel(side) {
    if (!queueRoot || !queuePanel) return;
    queuePanelChannel = side;
    queuePanel.setAttribute("data-channel", side);
    queueRoot.hidden = false;
    queueRoot.setAttribute("aria-hidden", "false");
    document.body.classList.add("beta-queue-open");
    setQueueLayoutClass();
    renderQueueList();
    if (queueCloseBtn) {
      try {
        queueCloseBtn.focus({ preventScroll: true });
      } catch (e) {
        queueCloseBtn.focus();
      }
    }
  }

  function closeQueuePanel() {
    if (!queueRoot) return;
    queueRoot.hidden = true;
    queueRoot.setAttribute("aria-hidden", "true");
    document.body.classList.remove("beta-queue-open");
    queuePanelChannel = null;
    syncQueueDrawerSideClass();
  }

  function applyBoostToGraph() {
    for (var i = 0; i < boostGains.length; i++) {
      var g = boostGains[i];
      if (!g) continue;
      g.gain.value = boostOn[i] ? BOOST_GAIN_ON : 1;
    }
  }

  function setBoostUi(idx) {
    var u = idx === 0 ? ui.left : ui.right;
    if (u.boost) {
      u.boost.setAttribute("aria-pressed", boostOn[idx] ? "true" : "false");
    }
  }

  function applyPansToGraph() {
    if (panners.length < 2) return;
    var pl = ui.left.pan ? parseFloat(ui.left.pan.value) : -1;
    var pr = ui.right.pan ? parseFloat(ui.right.pan.value) : 1;
    panners[0].pan.value = Number.isFinite(pl) ? clampPan(pl) : -1;
    panners[1].pan.value = Number.isFinite(pr) ? clampPan(pr) : 1;
  }

  function resumeAudioContextIfNeeded() {
    if (!ctx) return Promise.resolve(null);
    if (ctx.state === "suspended") {
      return ctx
        .resume()
        .then(function () {
          return ctx;
        })
        .catch(function () {
          return ctx;
        });
    }
    return Promise.resolve(ctx);
  }

  function ensureGraph() {
    if (ctx) {
      applyPansToGraph();
      applyBoostToGraph();
      return resumeAudioContextIfNeeded();
    }

    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      setStatus("Web Audio is not supported in this browser.", true);
      return Promise.reject(new Error("No AudioContext"));
    }

    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);

    for (var i = 0; i < 2; i++) {
      var g = ctx.createGain();
      var volEl = i === 0 ? ui.left.vol : ui.right.vol;
      var iv = volEl ? parseFloat(volEl.value) : 1;
      g.gain.value = Number.isFinite(iv) ? iv : 1;
      var b = ctx.createGain();
      b.gain.value = boostOn[i] ? BOOST_GAIN_ON : 1;
      var panner = ctx.createStereoPanner();
      var src = ctx.createMediaElementSource(audios[i]);
      src.connect(g);
      g.connect(b);
      b.connect(panner);
      panner.connect(masterGain);
      trackGains.push(g);
      boostGains.push(b);
      panners.push(panner);
    }

    applyBoostToGraph();

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
      var wrap = u.seek.closest(".beta-progress-wrap");
      if (wrap && wrap.style) {
        var pct = 0;
        if (Number.isFinite(d) && d > 0) {
          pct = Math.max(0, Math.min(100, ((el.currentTime || 0) / d) * 100));
        }
        wrap.style.setProperty("--seek-progress", pct + "%");
      }
    });
  }

  function loopSeek() {
    updateSeekUi();
    requestAnimationFrame(loopSeek);
  }

  function channelPlayIcon(isPlaying) {
    return isPlaying
      ? '<path fill="currentColor" d="M196 120h72v272h-72V120zm152 0h72v272h-72V120z"/>'
      : '<path fill="currentColor" d="M133 440a35.37 35.37 0 01-17.5-4.67c-12-6.8-19.46-20-19.46-34.33V111c0-14.37 7.46-27.53 19.46-34.33a35.13 35.13 0 0135.77.45l247.85 148.36a36 36 0 010 61l-247.89 148.4A35.5 35.5 0 01133 440z"/>';
  }

  function isLikelyAudioFile(file) {
    if (!file || file.size === 0) return false;
    var t = (file.type || "").toLowerCase();
    if (t.indexOf("audio/") === 0) return true;
    var n = (file.name || "").toLowerCase();
    return /\.(mp3|m4a|aac|wav|ogg|flac|webm)$/.test(n);
  }

  function filterAudioFiles(fileList) {
    if (!fileList || !fileList.length) return [];
    return Array.prototype.filter.call(fileList, isLikelyAudioFile);
  }

  function dataTransferHasFiles(dt) {
    if (!dt || !dt.types) return false;
    for (var i = 0; i < dt.types.length; i++) {
      if (dt.types[i] === "Files") return true;
    }
    return false;
  }

  function loadFilesIntoChannel(idx, files) {
    if (!files || files.length === 0) return;
    clearShuffleState(idx);
    channelRepeatMode[idx] = "off";
    channelQueueFiles[idx] = files.slice();
    channelCurrentIndex[idx] = 0;
    ensureGraph()
      .then(function () {
        return assignAudioFromCurrentIndex(idx, { doPlay: true });
      })
      .then(function () {
        setStatus("");
        updatePlayLabels();
        refreshQueuePanelIfOpen();
      })
      .catch(function () {});
  }

  function updatePlayLabels() {
    ["left", "right"].forEach(function (side) {
      var idx = side === "left" ? 0 : 1;
      var u = ui[side];
      var a = audios[idx];
      if (u.playBtn && a) {
        var playing = !a.paused;
        u.playBtn.innerHTML =
          '<svg class="ionicon beta-play-glyph" width="68" height="68" viewBox="0 0 512 512" aria-hidden="true">' +
          channelPlayIcon(playing) +
          "</svg>";
        u.playBtn.setAttribute("aria-label", playing ? "Pause " + side + " channel" : "Play " + side + " channel");
      }
    });

    if (dualPlayBtn) {
      var bothPlaying = !audioLeft.paused && !audioRight.paused;
      dualPlayBtn.innerHTML =
        '<svg class="ionicon beta-dual-play-glyph" width="88" height="88" viewBox="0 0 512 512" aria-hidden="true">' +
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
        var files = u.fileInput.files;
        if (!files || files.length === 0) return;
        loadFilesIntoChannel(idx, Array.prototype.slice.call(files, 0));
        u.fileInput.value = "";
      });
    }

    var segmentEl = document.querySelector(side === "left" ? ".beta-segment--left" : ".beta-segment--right");
    if (segmentEl) {
      var dragDepth = 0;
      function clearDropHover() {
        dragDepth = 0;
        segmentEl.classList.remove("beta-segment--drop-hover");
      }
      segmentEl.addEventListener("dragenter", function (e) {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        dragDepth++;
        segmentEl.classList.add("beta-segment--drop-hover");
      });
      segmentEl.addEventListener("dragleave", function (e) {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) segmentEl.classList.remove("beta-segment--drop-hover");
      });
      segmentEl.addEventListener("dragover", function (e) {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        try {
          e.dataTransfer.dropEffect = "copy";
        } catch (err) {}
      });
      segmentEl.addEventListener("drop", function (e) {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        clearDropHover();
        var picked = filterAudioFiles(e.dataTransfer.files);
        if (picked.length === 0) {
          setStatus("Drop audio files only (for example MP3, M4A, or WAV).", true);
          return;
        }
        loadFilesIntoChannel(idx, picked);
      });
      segmentEl.addEventListener("dragend", clearDropHover);
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
        openQueuePanel(side);
      });
    }

    if (u.boost) {
      u.boost.addEventListener("click", function () {
        boostOn[idx] = !boostOn[idx];
        setBoostUi(idx);
        ensureGraph()
          .then(function () {
            applyBoostToGraph();
          })
          .catch(function () {});
      });
    }

    if (u.speed) {
      u.speed.addEventListener("click", function () {
        speedIdx[idx] = (speedIdx[idx] + 1) % speedPresets.length;
        var rate = speedPresets[speedIdx[idx]];
        audios[idx].playbackRate = rate;
        renderSpeedLabels();
      });
    }
  }

  wireChannel("left");
  wireChannel("right");

  audios.forEach(function (a, idx) {
    a.addEventListener("play", function () {
      ensureGraph()
        .then(function () {
          updatePlayLabels();
        })
        .catch(function () {});
    });
    a.addEventListener("pause", updatePlayLabels);
    a.addEventListener("ended", function () {
      onTrackEndedForChannel(idx);
    });
  });

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

  document.addEventListener("keydown", function (e) {
    if (e.code !== "Space") return;
    var tg = e.target;
    if (queueRoot && !queueRoot.hidden && queueRoot.contains(/** @type {Node} */ (tg))) return;
    if (tg instanceof HTMLElement && tg.isContentEditable) return;
    if (tg instanceof HTMLInputElement || tg instanceof HTMLTextAreaElement || tg instanceof HTMLSelectElement) {
      if (!(tg instanceof HTMLInputElement) || tg.type !== "range") return;
    }
    e.preventDefault();
    if (dualPlayBtn) dualPlayBtn.click();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (queueRoot && !queueRoot.hidden) closeQueuePanel();
  });

  if (queueBackdrop) {
    queueBackdrop.addEventListener("click", function () {
      closeQueuePanel();
    });
  }
  if (queueCloseBtn) {
    queueCloseBtn.addEventListener("click", function () {
      closeQueuePanel();
    });
  }
  if (queueClearBtn) {
    queueClearBtn.addEventListener("click", function () {
      if (queuePanelChannel) clearChannelQueue(sideToIdx(queuePanelChannel));
    });
  }
  if (queueShuffleBtn) {
    queueShuffleBtn.addEventListener("click", function () {
      if (queuePanelChannel) toggleShuffleForChannel(sideToIdx(queuePanelChannel));
    });
  }
  if (queueRepeatBtn) {
    queueRepeatBtn.addEventListener("click", function () {
      if (queuePanelChannel) toggleRepeatForChannel(sideToIdx(queuePanelChannel));
    });
  }

  window.addEventListener("resize", function () {
    if (!queueRoot || queueRoot.hidden) return;
    setQueueLayoutClass();
  });

  function swapQueues() {
    var al = audioLeft;
    var ar = audioRight;
    var srcL = al.src;
    var srcR = ar.src;
    var metaL = { title: trackMeta[0].title, artist: trackMeta[0].artist || "" };
    var metaR = { title: trackMeta[1].title, artist: trackMeta[1].artist || "" };
    var tL = al.currentTime;
    var tR = ar.currentTime;
    var pausedL = al.paused;
    var pausedR = ar.paused;

    var qL = channelQueueFiles[0];
    var qR = channelQueueFiles[1];
    var iL = channelCurrentIndex[0];
    var iR = channelCurrentIndex[1];
    var shL = channelShuffleEnabled[0];
    var shR = channelShuffleEnabled[1];
    var snL = channelShuffleSnapshot[0];
    var snR = channelShuffleSnapshot[1];
    var rL = channelRepeatMode[0];
    var rR = channelRepeatMode[1];
    var blobL = channelLastBlobUrl[0];
    var blobR = channelLastBlobUrl[1];

    channelQueueFiles[0] = qR;
    channelQueueFiles[1] = qL;
    channelCurrentIndex[0] = iR;
    channelCurrentIndex[1] = iL;
    channelShuffleEnabled[0] = shR;
    channelShuffleEnabled[1] = shL;
    channelShuffleSnapshot[0] = snR ? snR.slice() : null;
    channelShuffleSnapshot[1] = snL ? snL.slice() : null;
    channelRepeatMode[0] = rR;
    channelRepeatMode[1] = rL;
    channelLastBlobUrl[0] = blobR;
    channelLastBlobUrl[1] = blobL;

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
      refreshQueuePanelIfOpen();
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
  renderSpeedLabels();
  setBoostUi(0);
  setBoostUi(1);
  updatePlayLabels();

  window.dicoticBeta = {
    ensureGraph: ensureGraph,
    swapQueues: swapQueues,
    openQueue: openQueuePanel,
    closeQueue: closeQueuePanel,
  };
})();
