/**
 * Web beta: two local audio streams with independent stereo panning.
 * Swap exchanges which track is heard in which ear; column controls follow the logical track.
 */

(function () {
  "use strict";

  /** @type {HTMLAudioElement} */
  const audioA = document.getElementById("beta-audio-a");
  /** @type {HTMLAudioElement} */
  const audioB = document.getElementById("beta-audio-b");
  const statusEl = document.getElementById("beta-status");
  const masterVolumeEl = document.getElementById("beta-master-volume");

  if (!audioA || !audioB) return;

  /** Which logical track (0 = element A, 1 = element B) the left column controls */
  let leftColumnTrack = 0;

  const trackMeta = [
    { title: "No track loaded" },
    { title: "No track loaded" },
  ];

  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {GainNode | null} */
  let masterGain = null;
  /** @type {GainNode[]} */
  const trackGains = [];
  /** @type {StereoPannerNode[]} */
  const panners = [];

  const audios = [audioA, audioB];

  const ui = {
    left: {
      stream: document.querySelector("#beta-channel-left .beta-track-title"),
      loadBtn: document.getElementById("beta-load-left"),
      fileInput: document.getElementById("beta-file-left"),
      playBtn: document.getElementById("beta-play-left"),
      seek: document.getElementById("beta-seek-left"),
      time: document.getElementById("beta-time-left"),
      vol: document.getElementById("beta-vol-left"),
    },
    right: {
      stream: document.querySelector("#beta-channel-right .beta-track-title"),
      loadBtn: document.getElementById("beta-load-right"),
      fileInput: document.getElementById("beta-file-right"),
      playBtn: document.getElementById("beta-play-right"),
      seek: document.getElementById("beta-seek-right"),
      time: document.getElementById("beta-time-right"),
      vol: document.getElementById("beta-vol-right"),
    },
  };

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.hidden = !msg;
    statusEl.classList.toggle("beta-status--error", !!isError);
  }

  function renderTitles() {
    const li = trackIndexForColumn("left");
    const ri = trackIndexForColumn("right");
    if (ui.left.stream) ui.left.stream.textContent = trackMeta[li].title;
    if (ui.right.stream) ui.right.stream.textContent = trackMeta[ri].title;
  }

  function ensureGraph() {
    if (ctx) return Promise.resolve(ctx);

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      setStatus("Web Audio is not supported in this browser.", true);
      return Promise.reject(new Error("No AudioContext"));
    }

    ctx = new AC();
    masterGain = ctx.createGain();
    const mv = masterVolumeEl ? parseFloat(masterVolumeEl.value) : 0.85;
    masterGain.gain.value = Number.isFinite(mv) ? mv : 0.85;
    masterGain.connect(ctx.destination);

    for (let i = 0; i < 2; i++) {
      const g = ctx.createGain();
      const volEl = i === 0 ? ui.left.vol : ui.right.vol;
      const iv = volEl ? parseFloat(volEl.value) : 1;
      g.gain.value = Number.isFinite(iv) ? iv : 1;
      const panner = ctx.createStereoPanner();
      const src = ctx.createMediaElementSource(audios[i]);
      src.connect(g);
      g.connect(panner);
      panner.connect(masterGain);
      trackGains.push(g);
      panners.push(panner);
    }

    applyPanning();
    return ctx.state === "suspended" ? ctx.resume() : Promise.resolve(ctx);
  }

  function applyPanning() {
    if (panners.length < 2) return;
    if (leftColumnTrack === 0) {
      panners[0].pan.value = -1;
      panners[1].pan.value = 1;
    } else {
      panners[0].pan.value = 1;
      panners[1].pan.value = -1;
    }
  }

  function trackIndexForColumn(side) {
    if (side === "left") return leftColumnTrack;
    return leftColumnTrack === 0 ? 1 : 0;
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function updateSeekUi() {
    ["left", "right"].forEach(function (side) {
      const idx = trackIndexForColumn(/** @type {"left"|"right"} */ (side));
      const el = audios[idx];
      const seek = ui[side].seek;
      const time = ui[side].time;
      if (!seek || !time || !el) return;
      const d = el.duration;
      seek.max = Number.isFinite(d) && d > 0 ? d : 0;
      if (!seek.dataset.dragging) seek.value = String(el.currentTime || 0);
      time.textContent = `${formatTime(el.currentTime)} / ${formatTime(Number.isFinite(d) ? d : 0)}`;
    });
  }

  function loopSeek() {
    updateSeekUi();
    requestAnimationFrame(loopSeek);
  }

  function wireChannel(side) {
    const u = ui[side];
    const idx = function () {
      return trackIndexForColumn(/** @type {"left"|"right"} */ (side));
    };

    if (u.loadBtn && u.fileInput) {
      u.loadBtn.addEventListener("click", function () {
        u.fileInput.click();
      });
      u.fileInput.addEventListener("change", function () {
        const f = u.fileInput.files && u.fileInput.files[0];
        if (!f) return;
        ensureGraph()
          .then(function () {
            const i = idx();
            const a = audios[i];
            const prev = a.src;
            if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
            a.src = URL.createObjectURL(f);
            trackMeta[i].title = f.name || "Local file";
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
            const a = audios[idx()];
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
            const a = audios[idx()];
            const v = parseFloat(u.seek.value);
            if (Number.isFinite(v)) a.currentTime = v;
          })
          .catch(function () {});
      });
    }

    if (u.vol) {
      u.vol.addEventListener("input", function () {
        ensureGraph()
          .then(function () {
            const g = trackGains[idx()];
            if (!g) return;
            const v = parseFloat(u.vol.value);
            g.gain.value = Number.isFinite(v) ? v : 1;
          })
          .catch(function () {});
      });
    }
  }

  wireChannel("left");
  wireChannel("right");

  audios.forEach(function (a) {
    a.addEventListener("play", function () {
      ensureGraph().catch(function () {});
      updatePlayLabels();
    });
    a.addEventListener("pause", updatePlayLabels);
    a.addEventListener("ended", updatePlayLabels);
  });

  function updatePlayLabels() {
    ["left", "right"].forEach(function (side) {
      const u = ui[side];
      const a = audios[trackIndexForColumn(/** @type {"left"|"right"} */ (side))];
      if (u.playBtn && a) {
        const label = a.paused ? "Play" : "Pause";
        u.playBtn.textContent = label;
        u.playBtn.setAttribute("aria-label", label + " " + side + " channel");
      }
    });
  }

  if (masterVolumeEl) {
    masterVolumeEl.addEventListener("input", function () {
      const v = parseFloat(masterVolumeEl.value);
      if (masterGain) masterGain.gain.value = Number.isFinite(v) ? v : 0.85;
    });
  }

  function swapQueues() {
    leftColumnTrack = leftColumnTrack === 0 ? 1 : 0;
    applyPanning();
    renderTitles();
    updatePlayLabels();
    updateSeekUi();

    const split = document.querySelector(".beta-page .ear-split");
    if (!split) return;
    const leftStreams = split.querySelector(".ear-left .ear-streams");
    const rightStreams = split.querySelector(".ear-right .ear-streams");
    if (!leftStreams || !rightStreams) return;

    const useFade = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (useFade) {
      leftStreams.classList.add("is-fading");
      rightStreams.classList.add("is-fading");
      setTimeout(function () {
        const lh = leftStreams.innerHTML;
        const rh = rightStreams.innerHTML;
        leftStreams.innerHTML = rh;
        rightStreams.innerHTML = lh;
        leftStreams.classList.remove("is-fading");
        rightStreams.classList.remove("is-fading");
        renderTitles();
      }, 150);
      return;
    }

    leftStreams.classList.add("slide-left-out");
    rightStreams.classList.add("slide-right-out");
    setTimeout(function () {
      const lh = leftStreams.innerHTML;
      const rh = rightStreams.innerHTML;
      leftStreams.innerHTML = rh;
      rightStreams.innerHTML = lh;
      leftStreams.classList.remove("slide-left-out");
      rightStreams.classList.remove("slide-right-out");
      leftStreams.classList.add("slide-from-left");
      rightStreams.classList.add("slide-from-right");
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          leftStreams.classList.remove("slide-from-left");
          rightStreams.classList.remove("slide-from-right");
          renderTitles();
        });
      });
    }, 300);
  }

  document.querySelectorAll(".beta-page .ear-swap-btn").forEach(function (btn) {
    btn.addEventListener("click", swapQueues);
  });
  const phoneSwap = document.querySelector(".beta-page .swap-button");
  if (phoneSwap) phoneSwap.addEventListener("click", swapQueues);

  ensureGraph()
    .then(function () {
      if (masterVolumeEl && masterGain) {
        const v = parseFloat(masterVolumeEl.value);
        masterGain.gain.value = Number.isFinite(v) ? v : 0.85;
      }
      ["left", "right"].forEach(function (side) {
        const vol = ui[side].vol;
        const g = trackGains[trackIndexForColumn(/** @type {"left"|"right"} */ (side))];
        if (vol && g) {
          const x = parseFloat(vol.value);
          g.gain.value = Number.isFinite(x) ? x : 1;
        }
      });
    })
    .catch(function () {});

  requestAnimationFrame(loopSeek);
  renderTitles();
  updatePlayLabels();

  window.dicoticBeta = { swapQueues: swapQueues, ensureGraph: ensureGraph };
})();
