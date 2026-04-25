/**
 * Web beta — mirrors dicotic iOS: per-channel Balance (pan -1..1), separate volumes,
 * swap queues (exchange tracks; pans stay with Left/Right columns), dual play,
 * queue sheet / drawer, shuffle (random advance), per-row delete, queue drag-reorder.
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
  const queueCloseBtn = document.getElementById("beta-queue-close");
  const queueClearBtn = document.getElementById("beta-queue-clear");
  const queueEmptyEl = document.getElementById("beta-queue-empty");
  const spotifyRoot = document.getElementById("beta-spotify-root");
  const spotifyBackdrop = document.getElementById("beta-spotify-backdrop");
  const spotifyPanel = document.getElementById("beta-spotify-panel");
  const spotifyTitle = document.getElementById("beta-spotify-title");
  const spotifyCloseBtn = document.getElementById("beta-spotify-close");
  const spotifyTransferBtn = document.getElementById("beta-spotify-transfer");
  const spotifyDisableBtn = document.getElementById("beta-spotify-disable");
  const spotifyHintEl = document.getElementById("beta-spotify-hint");

  if (!audioLeft || !audioRight) return;

  var Engine = window.dicoticPortalEngine || {};
  /** When false, local playback stays at 1×; speed buttons stay visible but disabled. */
  var localSpeedStepEnabled = Engine.LOCAL_SPEED_STEP_ENABLED === true;
  /** iOS WebKit: keep graph + pan; pin 1× — non‑1× + MediaElementSource is unstable on WebKit. */
  var iosLocalSpeedLocked = isIOSWebKitRuntime();
  var localSpeedStepEnabledEffective = localSpeedStepEnabled && !iosLocalSpeedLocked;
  var speedTapGuard =
    localSpeedStepEnabledEffective && typeof Engine.createTapGuard === "function"
      ? Engine.createTapGuard(320)
      : function () {
          return true;
        };
  var mainPlayTapGuard =
    typeof Engine.createTapGuard === "function"
      ? Engine.createTapGuard(280)
      : function () {
          return true;
        };
  var prevNextTapGuard =
    typeof Engine.createTapGuard === "function"
      ? Engine.createTapGuard(260)
      : function () {
          return true;
        };
  /** Re-entrancy guard while swapQueues async finish runs. */
  var swapInFlight = false;

  /** Sticky midpoint — PanSlider.tsx CENTER_SNAP_THRESHOLD */
  var CENTER_SNAP = 0.08;

  /** @typedef {'left'|'right'} ChannelSide */
  /** @typedef {'local'|'portal'} SourceKind */

  var trackMeta = [
    { title: "No track loaded", artist: "" },
    { title: "No track loaded", artist: "" },
  ];

  /** @type {File[][]} Full queue per channel (dicotic leftQueue/rightQueue). */
  var channelQueueFiles = [[], []];
  /** @type {number[]} Current playback index into channelQueueFiles. */
  var channelCurrentIndex = [0, 0];
  /** @type {boolean[]} When true, next / end-of-track picks a random index (list order unchanged). */
  var channelShuffleEnabled = [false, false];
  /** Last blob: URL string per channel for revoke (parallel to audio.src when blob). */
  var channelLastBlobUrl = ["", ""];
  /** Monotonic local-load request ids to ignore stale async callbacks. */
  var channelLoadRequestId = [0, 0];
  /** Explicit playback intent for each local channel. */
  var channelShouldBePlaying = [false, false];
  /** Monotonic token used to cancel stale async play attempts. */
  var channelPlayIntentToken = [0, 0];
  /** @type {SourceKind[]} */
  var channelSourceKind = ["local", "local"];
  /** @type {Array<{ title: string, artist: string, isPlaying: boolean, currentTime: number, duration: number, playbackRate: number, canSeek: boolean, onPlayPause: ((nextPlaying: boolean) => void) | null, onSeek: ((seconds: number) => void) | null, onNext: (() => void) | null, onPrev: (() => void) | null, onSetSpeed: ((rate: number) => void) | null, onSwapToSide: ((side: ChannelSide) => void) | null } | null>} */
  var channelPortalState = [null, null];


  var speedPresets = [0.75, 1, 1.25, 1.5];
  var speedIdx = [1, 1];
  var RATE_EPSILON = 0.001;
  var lastAppliedRateByChannel = [1, 1];
  var lastAppliedPitchByChannel = [null, null];

  /** @type {AudioContext | null} */
  var ctx = null;
  /** @type {GainNode | null} */
  var masterGain = null;
  /** @type {GainNode[]} */
  var trackGains = [];
  /** @type {StereoPannerNode[]} */
  var panners = [];

  var audios = [audioLeft, audioRight];
  var spotifyHolder = { api: null };
  var queueHolder = { api: null };

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
      seekBack: document.getElementById("beta-seekback-left"),
      seekForward: document.getElementById("beta-seekfwd-left"),
      next: document.getElementById("beta-next-left"),
      queue: document.getElementById("beta-queue-left"),
      spotify: document.getElementById("beta-spotify-left"),
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
      seekBack: document.getElementById("beta-seekback-right"),
      seekForward: document.getElementById("beta-seekfwd-right"),
      next: document.getElementById("beta-next-right"),
      queue: document.getElementById("beta-queue-right"),
      spotify: document.getElementById("beta-spotify-right"),
      boost: document.getElementById("beta-boost-right"),
      speed: document.getElementById("beta-speed-right"),
      speedLabel: document.querySelector("#beta-speed-right .beta-speed-label"),
    },
  };


  function sideToIdx(side) {
    return side === "left" ? 0 : 1;
  }

  function idxToSide(idx) {
    return idx === 0 ? "left" : "right";
  }

  function isIOSDevice() {
    if (typeof navigator === "undefined") return false;
    var ua = navigator.userAgent || "";
    var platform = navigator.platform || "";
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return platform === "MacIntel" && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
  }

  function isIOSSpotifyVolumeLocked(chIdx) {
    return isIOSDevice() && isPortalChannel(chIdx);
  }

  function isPortalChannel(chIdx) {
    return channelSourceKind[chIdx] === "portal";
  }

  function getChannelController(chIdx) {
    var portalState = channelPortalState[chIdx];
    var audio = audios[chIdx];
    return {
      isPortal: isPortalChannel(chIdx),
      isPlaying: function () {
        return isPortalChannel(chIdx) && portalState ? !!portalState.isPlaying : !audio.paused;
      },
      playPause: function (nextPlaying) {
        if (isPortalChannel(chIdx) && portalState && portalState.onPlayPause) {
          safeCall(portalState.onPlayPause, [!!nextPlaying]);
          return Promise.resolve();
        }
        if (nextPlaying) {
          var token = setPlayIntent(chIdx, true);
          return ensureGraph()
            .then(function () {
              if (!channelShouldBePlaying[chIdx] || currentPlayIntentToken(chIdx) !== token) return;
              return audio.play();
            })
            .catch(function () {});
        }
        setPlayIntent(chIdx, false);
        audio.pause();
        return Promise.resolve();
      },
      seek: function (seconds) {
        if (isPortalChannel(chIdx) && portalState && portalState.onSeek) {
          safeCall(portalState.onSeek, [seconds]);
          return Promise.resolve();
        }
        return ensureGraph()
          .then(function () {
            if (Number.isFinite(seconds)) audio.currentTime = seconds;
          })
          .catch(function () {});
      },
      setVolume: function (nextVolume) {
        var clamped = Number.isFinite(nextVolume) ? Math.max(0, Math.min(1, nextVolume)) : 1;
        if (isPortalChannel(chIdx)) {
          if (spotifyHolder.api) return spotifyHolder.api.setVolumeFromChannel(chIdx, clamped);
          return Promise.resolve();
        }
        return ensureGraph()
          .then(function () {
            var g = trackGains[chIdx];
            if (g) g.gain.value = clamped;
          })
          .catch(function () {});
      },
      queuePrev: function () {
        if (isPortalChannel(chIdx)) {
          if (portalState && portalState.onPrev) safeCall(portalState.onPrev, []);
          return;
        }
        skipToPreviousTrack(chIdx);
      },
      queueNext: function () {
        if (isPortalChannel(chIdx)) {
          if (portalState && portalState.onNext) safeCall(portalState.onNext, []);
          return;
        }
        skipToNextTrack(chIdx);
      },
      setSpeed: function (rate) {
        if (isPortalChannel(chIdx)) {
          if (portalState && portalState.onSetSpeed) safeCall(portalState.onSetSpeed, [rate]);
          return;
        }
        if (iosLocalSpeedLocked) {
          applyLocalRateToAudio(audio, 1);
          return;
        }
        applyLocalRateToAudio(audio, rate);
      },
      swapToSide: function (side) {
        if (isPortalChannel(chIdx) && portalState && portalState.onSwapToSide) safeCall(portalState.onSwapToSide, [side]);
      },
    };
  }

  function getDisplayMeta(chIdx) {
    var portalState = channelPortalState[chIdx];
    if (isPortalChannel(chIdx) && portalState) {
      return {
        title: portalState.title || "Spotify portal",
        artist: portalState.artist || "",
      };
    }
    return {
      title: trackMeta[chIdx].title || "No track loaded",
      artist: trackMeta[chIdx].artist || "",
    };
  }

  function normalizePortalState(descriptor, forceSourceKind) {
    var d = descriptor || {};
    return {
      sourceKind: forceSourceKind || (d.sourceKind === "portal" ? "portal" : "local"),
      title: typeof d.title === "string" ? d.title : "",
      artist: typeof d.artist === "string" ? d.artist : "",
      isPlaying: !!d.isPlaying,
      currentTime: Number.isFinite(d.currentTime) ? d.currentTime : 0,
      duration: Number.isFinite(d.duration) ? d.duration : 0,
      playbackRate: Number.isFinite(d.playbackRate) && d.playbackRate > 0 ? d.playbackRate : 1,
      canSeek: d.canSeek !== false,
      onPlayPause: typeof d.onPlayPause === "function" ? d.onPlayPause : null,
      onSeek: typeof d.onSeek === "function" ? d.onSeek : null,
      onNext: typeof d.onNext === "function" ? d.onNext : null,
      onPrev: typeof d.onPrev === "function" ? d.onPrev : null,
      onSetSpeed: typeof d.onSetSpeed === "function" ? d.onSetSpeed : null,
      onSwapToSide: typeof d.onSwapToSide === "function" ? d.onSwapToSide : null,
    };
  }

  function safeCall(fn, args) {
    if (typeof fn !== "function") return;
    try {
      fn.apply(null, args || []);
    } catch (err) {}
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.hidden = !msg;
    statusEl.classList.toggle("beta-status--error", !!isError);
  }

  /**
   * @param {Element | null} controlEl
   * @param {boolean} locked
   * @param {string} tipText
   */
  function syncDisabledGuard(controlEl, locked, tipText) {
    if (!controlEl) return;
    var guard = controlEl.parentElement;
    if (!guard || !guard.classList || !guard.classList.contains("beta-disabled-guard")) return;
    guard.classList.toggle("beta-disabled-guard--locked", !!locked);
    if (locked && tipText) {
      guard.setAttribute("title", tipText);
      guard.setAttribute("data-beta-tip", tipText);
      controlEl.removeAttribute("title");
    } else {
      guard.removeAttribute("title");
      guard.removeAttribute("data-beta-tip");
      controlEl.removeAttribute("title");
    }
  }

  function refreshVolumeInteractivity() {
    ["left", "right"].forEach(function (side) {
      var idx = sideToIdx(side);
      var u = ui[side];
      if (!u) return;
      var volumeLocked = isIOSSpotifyVolumeLocked(idx);
      if (u.vol) {
        u.vol.disabled = !!volumeLocked;
      }
      if (u.vol) {
        if (volumeLocked) {
          u.vol.setAttribute(
            "aria-label",
            (side === "left" ? "Left" : "Right") + " volume controlled by iOS hardware buttons while Spotify is active",
          );
          syncDisabledGuard(
            u.vol,
            true,
            "On iOS, Spotify volume is controlled by hardware buttons.",
          );
        } else {
          u.vol.setAttribute("aria-label", (side === "left" ? "Left" : "Right") + " volume");
          syncDisabledGuard(u.vol, false, "");
        }
      }

      if (u.pan) {
        var panLocked = isPortalChannel(idx);
        u.pan.disabled = panLocked;
        if (isPortalChannel(idx)) {
          u.pan.setAttribute(
            "aria-label",
            (side === "left" ? "Left" : "Right") + " balance unavailable while Spotify portal is active",
          );
          syncDisabledGuard(
            u.pan,
            true,
            "Balance is unavailable while Spotify portal is active.",
          );
        } else {
          u.pan.setAttribute("aria-label", (side === "left" ? "Left" : "Right") + " channel balance");
          syncDisabledGuard(u.pan, false, "");
        }
      }
    });
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

  function mirrorPanValue(value, fallback) {
    var raw = parseFloat(String(value));
    var base = Number.isFinite(raw) ? raw : fallback;
    return clampPan(-base);
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
      var portalState = channelPortalState[idx];
      var isPortal = isPortalChannel(idx);
      var rate;
      if (isPortal && portalState) {
        rate =
          Number.isFinite(portalState.playbackRate) && portalState.playbackRate > 0
            ? portalState.playbackRate
            : 1;
      } else if (!localSpeedStepEnabledEffective) {
        rate = 1;
      } else {
        rate = speedPresets[speedIdx[idx]] || 1;
      }
      if (u.speedLabel) u.speedLabel.textContent = formatSpeedLabel(rate);
      if (u.speed) {
        var speedDisabled = isPortal || !localSpeedStepEnabledEffective;
        u.speed.disabled = speedDisabled;
        if (isPortal) {
          u.speed.setAttribute("aria-label", (side === "left" ? "Left" : "Right") + " playback speed unavailable for Spotify");
        } else if (!localSpeedStepEnabled) {
          u.speed.setAttribute(
            "aria-label",
            (side === "left" ? "Left" : "Right") + " playback speed fixed at 1× (disabled in this beta)",
          );
        } else if (iosLocalSpeedLocked) {
          u.speed.setAttribute(
            "aria-label",
            (side === "left" ? "Left" : "Right") + " playback speed fixed at 1× on iOS Safari and Chrome",
          );
        } else {
          u.speed.setAttribute("aria-label", (side === "left" ? "Left" : "Right") + " playback speed " + formatSpeedLabel(rate));
        }
        var speedTip = "";
        if (speedDisabled) {
          if (isPortal) {
            speedTip = "Playback speed is controlled by Spotify while this portal is active.";
          } else if (!localSpeedStepEnabled) {
            speedTip = "Speed changes are disabled in this web beta.";
          } else if (iosLocalSpeedLocked) {
            speedTip = "Playback speed stays at 1× on iOS Safari and Chrome.";
          }
        }
        syncDisabledGuard(u.speed, speedDisabled, speedTip);
      }
    });
  }

  function applyChannelVolumeToGraph(idx) {
    var u = idx === 0 ? ui.left : ui.right;
    if (!u || !u.vol) return;
    var v = parseFloat(u.vol.value);
    var clamped = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
    var g = trackGains[idx];
    if (!g) return;
    g.gain.value = clamped;
  }

  function setPlayIntent(chIdx, shouldPlay) {
    channelShouldBePlaying[chIdx] = !!shouldPlay;
    channelPlayIntentToken[chIdx] += 1;
    return channelPlayIntentToken[chIdx];
  }

  function currentPlayIntentToken(chIdx) {
    return channelPlayIntentToken[chIdx];
  }

  function isIOSWebKitRuntime() {
    if (typeof navigator === "undefined") return false;
    var ua = navigator.userAgent || "";
    var isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    return isIOS && /AppleWebKit/i.test(ua);
  }

  function rateChangedEnough(prevRate, nextRate) {
    if (!Number.isFinite(prevRate)) return true;
    if (!Number.isFinite(nextRate)) return false;
    return Math.abs(prevRate - nextRate) > RATE_EPSILON;
  }

  function resolveAudioChannelIndex(audioEl) {
    if (audioEl === audios[0]) return 0;
    if (audioEl === audios[1]) return 1;
    return -1;
  }

  function shouldDisablePitchPreserveForRate(rate) {
    // Safari has audible artifacts with preservesPitch at >=1.5x on some versions.
    var ua = (navigator && navigator.userAgent) || "";
    var isSafari =
      /safari/i.test(ua) &&
      !/chrome|chromium|crios|android|fxios|edgios/i.test(ua);
    return isSafari && rate >= 1.5;
  }

  function applyLocalRateNow(chIdx, audioEl, safeRate) {
    var preservePitch = !shouldDisablePitchPreserveForRate(safeRate);
    var lastRate = chIdx >= 0 ? lastAppliedRateByChannel[chIdx] : audioEl.playbackRate;
    var lastPitch = chIdx >= 0 ? lastAppliedPitchByChannel[chIdx] : null;
    try {
      if (lastPitch !== preservePitch) {
        if ("preservesPitch" in audioEl) audioEl.preservesPitch = preservePitch;
        if ("webkitPreservesPitch" in audioEl) audioEl.webkitPreservesPitch = preservePitch;
        if ("mozPreservesPitch" in audioEl) audioEl.mozPreservesPitch = preservePitch;
      }
      if (rateChangedEnough(lastRate, safeRate)) audioEl.playbackRate = safeRate;
    } catch (e) {}
    if (chIdx >= 0) {
      lastAppliedRateByChannel[chIdx] = safeRate;
      lastAppliedPitchByChannel[chIdx] = preservePitch;
    }
  }

  function applyLocalRateToAudio(audioEl, rate) {
    var safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
    var chIdx = resolveAudioChannelIndex(audioEl);
    applyLocalRateNow(chIdx, audioEl, safeRate);
  }

  function syncLocalPlaybackRate(idx) {
    if (isPortalChannel(idx)) return;
    var rate = iosLocalSpeedLocked ? 1 : localSpeedStepEnabled ? speedPresets[speedIdx[idx]] || 1 : 1;
    applyLocalRateToAudio(audios[idx], rate);
  }

  function pauseLocalChannel(chIdx) {
    audios[chIdx].pause();
  }

  function renderTitles() {
    if (ui.left.title) {
      var leftMeta = getDisplayMeta(0);
      ui.left.title.textContent = leftMeta.title;
      ui.left.title.classList.toggle("beta-track-title--muted", leftMeta.title === "No track loaded");
    }
    if (ui.left.artist) {
      var leftArtist = getDisplayMeta(0).artist || "";
      ui.left.artist.textContent = leftArtist;
      ui.left.artist.classList.toggle("beta-track-artist--empty", !leftArtist);
    }
    if (ui.right.title) {
      var rightMeta = getDisplayMeta(1);
      ui.right.title.textContent = rightMeta.title;
      ui.right.title.classList.toggle("beta-track-title--muted", rightMeta.title === "No track loaded");
    }
    if (ui.right.artist) {
      var rightArtist = getDisplayMeta(1).artist || "";
      ui.right.artist.textContent = rightArtist;
      ui.right.artist.classList.toggle("beta-track-artist--empty", !rightArtist);
    }
  }

  function clearShuffleState(chIdx) {
    channelShuffleEnabled[chIdx] = false;
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
    channelLoadRequestId[chIdx] += 1;
    var loadRequestId = channelLoadRequestId[chIdx];
    revokeBlobForChannel(chIdx);
    if (!f) {
      a.removeAttribute("src");
      a.load();
      trackMeta[chIdx] = { title: "No track loaded", artist: "" };
      if (channelSourceKind[chIdx] === "local") syncLocalPlaybackRate(chIdx);
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
    var intentToken = Number.isFinite(opts.intentToken) ? opts.intentToken : currentPlayIntentToken(chIdx);
    return new Promise(function (resolve) {
      function afterMeta() {
        a.removeEventListener("loadedmetadata", afterMeta);
        if (channelLoadRequestId[chIdx] !== loadRequestId || channelSourceKind[chIdx] !== "local") {
          resolve();
          return;
        }
        syncLocalPlaybackRate(chIdx);
        if (typeof seekTo === "number" && Number.isFinite(seekTo) && seekTo >= 0) {
          try {
            a.currentTime = seekTo;
          } catch (e) {}
        }
        if (opts.doPlay) {
          if (!channelShouldBePlaying[chIdx] || currentPlayIntentToken(chIdx) !== intentToken) {
            resolve();
            return;
          }
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
    channelQueueFiles[chIdx] = [];
    channelCurrentIndex[chIdx] = 0;
    setPlayIntent(chIdx, false);
    pauseLocalChannel(chIdx);
    revokeBlobForChannel(chIdx);
    audios[chIdx].removeAttribute("src");
    audios[chIdx].load();
    trackMeta[chIdx] = { title: "No track loaded", artist: "" };
    refreshChannelUi(chIdx, { includeQueue: true });
  }

  function toggleShuffleForChannel(chIdx) {
    var q = getQueue(chIdx);
    if (q.length <= 1) return;
    channelShuffleEnabled[chIdx] = !channelShuffleEnabled[chIdx];
    if (queueHolder.api) queueHolder.api.refreshIfOpen();
  }

  function onTrackEndedForChannel(chIdx) {
    var q = getQueue(chIdx);
    var index = channelCurrentIndex[chIdx];
    if (channelShuffleEnabled[chIdx] && q.length > 1 && typeof Engine.randomShuffleAdvanceIndex === "function") {
      channelCurrentIndex[chIdx] = Engine.randomShuffleAdvanceIndex({ queueLen: q.length, currentIndex: index });
      assignAndRefresh(chIdx, { doPlay: channelShouldBePlaying[chIdx], intentToken: currentPlayIntentToken(chIdx) });
      return;
    }
    var r =
      typeof Engine.transportAfterTrackEnded === "function"
        ? Engine.transportAfterTrackEnded({
            queueLen: q.length,
            index: index,
            playing: channelShouldBePlaying[chIdx],
          })
        : null;
    if (!r) {
      applyPausedTransport(chIdx);
      return;
    }
    if (r.pause) {
      applyPausedTransport(chIdx);
      return;
    }
    channelCurrentIndex[chIdx] = r.index;
    var opts = { doPlay: r.doPlay, intentToken: currentPlayIntentToken(chIdx) };
    if (typeof r.seekTo === "number" && Number.isFinite(r.seekTo) && r.seekTo >= 0) opts.seekTo = r.seekTo;
    assignAndRefresh(chIdx, opts);
  }

  function skipToNextTrack(chIdx) {
    var q = getQueue(chIdx);
    if (q.length === 0) return;
    var playing = channelShouldBePlaying[chIdx];
    var index = channelCurrentIndex[chIdx];
    if (channelShuffleEnabled[chIdx] && q.length > 1 && typeof Engine.randomShuffleAdvanceIndex === "function") {
      channelCurrentIndex[chIdx] = Engine.randomShuffleAdvanceIndex({ queueLen: q.length, currentIndex: index });
      assignAndRefresh(chIdx, { doPlay: playing, intentToken: currentPlayIntentToken(chIdx) });
      return;
    }
    var r =
      typeof Engine.transportManualNext === "function"
        ? Engine.transportManualNext({
            queueLen: q.length,
            index: index,
            playing: playing,
          })
        : null;
    if (!r || r.noop) return;
    if (r.pause) {
      applyPausedTransport(chIdx);
      return;
    }
    channelCurrentIndex[chIdx] = r.index;
    assignAndRefresh(chIdx, { doPlay: r.doPlay, intentToken: currentPlayIntentToken(chIdx) });
  }

  /** Previous: always previous item in list order (shuffle affects forward only). */
  function skipToPreviousTrack(chIdx) {
    var q = getQueue(chIdx);
    if (q.length === 0) return;
    var playing = channelShouldBePlaying[chIdx];
    var index = channelCurrentIndex[chIdx];
    var r =
      typeof Engine.transportManualPrev === "function"
        ? Engine.transportManualPrev({
            queueLen: q.length,
            index: index,
            playing: playing,
          })
        : null;
    if (!r || r.noop) return;
    channelCurrentIndex[chIdx] = r.index;
    var opts = { doPlay: r.doPlay, intentToken: currentPlayIntentToken(chIdx) };
    if (typeof r.seekTo === "number" && Number.isFinite(r.seekTo) && r.seekTo >= 0) opts.seekTo = r.seekTo;
    assignAndRefresh(chIdx, opts);
  }

  function playFromIndex(chIdx, listIndex) {
    var q = getQueue(chIdx);
    if (q.length === 0) return;
    var clamped = Math.max(0, Math.min(listIndex, q.length - 1));
    channelCurrentIndex[chIdx] = clamped;
    var token = setPlayIntent(chIdx, true);
    assignAndRefresh(chIdx, { doPlay: true, intentToken: token });
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
      setPlayIntent(chIdx, false);
      clearShuffleState(chIdx);
      revokeBlobForChannel(chIdx);
      audios[chIdx].removeAttribute("src");
      audios[chIdx].load();
      trackMeta[chIdx] = { title: "No track loaded", artist: "" };
    } else if (removedCurrent) {
      assignAudioFromCurrentIndex(chIdx, { doPlay: channelShouldBePlaying[chIdx], intentToken: currentPlayIntentToken(chIdx) });
    }
    refreshChannelUi(chIdx, { includeQueue: true });
  }

  function updateQueueHeaderButtons(chIdx) {
    if (!queueShuffleBtn) return;
    var sh = channelShuffleEnabled[chIdx];
    queueShuffleBtn.setAttribute("aria-pressed", sh ? "true" : "false");
    queueShuffleBtn.classList.toggle("beta-queue-icon--active", sh);
    queueShuffleBtn.setAttribute(
      "aria-label",
      sh ? "Shuffle on: next track picks randomly from the list" : "Shuffle off: play in list order",
    );
  }

  /**
   * Reorder queue after drag-and-drop. `toIndex` is the row index to insert before (in pre-move indices).
   * Keeps playback on the same file via indexOf after reorder.
   */
  function reorderQueueItem(chIdx, fromIndex, toIndex) {
    var q = channelQueueFiles[chIdx];
    if (fromIndex < 0 || fromIndex >= q.length || toIndex < 0 || toIndex > q.length) return;
    if (fromIndex === toIndex) return;
    var curFile = q[channelCurrentIndex[chIdx]] || null;
    var file = q.splice(fromIndex, 1)[0];
    var insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
    q.splice(insertAt, 0, file);
    if (curFile) {
      var ni = q.indexOf(curFile);
      channelCurrentIndex[chIdx] = ni >= 0 ? ni : 0;
    }
    if (queueHolder.api) queueHolder.api.refreshIfOpen();
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
      return resumeAudioContextIfNeeded();
    }

    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      setStatus("Web Audio is not supported in this browser.", true);
      return Promise.reject(new Error("No AudioContext"));
    }

    try {
      ctx = new AC({ sampleRate: 44100 });
    } catch (e1) {
      ctx = new AC();
    }
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
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
      var portalState = channelPortalState[idx];
      var current = 0;
      var duration = 0;
      if (isPortalChannel(idx) && portalState) {
        current = Number.isFinite(portalState.currentTime) ? portalState.currentTime : 0;
        duration = Number.isFinite(portalState.duration) ? portalState.duration : 0;
        u.seek.disabled = portalState.canSeek === false;
      } else {
        var d = el.duration;
        current = el.currentTime || 0;
        duration = Number.isFinite(d) ? d : 0;
        u.seek.disabled = false;
      }
      u.seek.max = duration > 0 ? duration : 0;
      if (!u.seek.dataset.dragging) u.seek.value = String(current);
      u.timeEl.textContent = formatTime(current);
      u.timeDur.textContent = formatTime(duration);
      var seekLocked = isPortalChannel(idx) && portalState && portalState.canSeek === false;
      syncDisabledGuard(
        u.seek,
        seekLocked,
        seekLocked ? "Track scrubbing is not available for this Spotify playback." : "",
      );
      var wrap = u.seek.closest(".beta-progress-wrap");
      if (wrap && wrap.style) {
        var pct = 0;
        if (duration > 0) {
          pct = Math.max(0, Math.min(100, (current / duration) * 100));
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
      ? '<rect x="112" y="92" width="116" height="328" rx="26" ry="26" fill="currentColor"/><rect x="284" y="92" width="116" height="328" rx="26" ry="26" fill="currentColor"/>'
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
    channelQueueFiles[idx] = files.slice();
    channelCurrentIndex[idx] = 0;
    ensureGraph()
      .then(function () {
        var token = setPlayIntent(idx, true);
        return assignAudioFromCurrentIndex(idx, { doPlay: true, intentToken: token });
      })
      .then(function () {
        setStatus("");
        updatePlayLabels();
        if (queueHolder.api) queueHolder.api.refreshIfOpen();
      })
      .catch(function () {});
  }

  function updatePlayLabels() {
    ["left", "right"].forEach(function (side) {
      var idx = side === "left" ? 0 : 1;
      var u = ui[side];
      var a = audios[idx];
      if (u.playBtn && a) {
        var portalState = channelPortalState[idx];
        var playing = isPortalChannel(idx) && portalState ? !!portalState.isPlaying : !a.paused;
        u.playBtn.innerHTML =
          '<svg class="ionicon beta-play-glyph" width="68" height="68" viewBox="0 0 512 512" aria-hidden="true">' +
          channelPlayIcon(playing) +
          "</svg>";
        u.playBtn.setAttribute("aria-label", playing ? "Pause " + side + " channel" : "Play " + side + " channel");
      }
    });

    if (dualPlayBtn) {
      var leftPlaying = isPortalChannel(0) && channelPortalState[0] ? !!channelPortalState[0].isPlaying : !audioLeft.paused;
      var rightPlaying = isPortalChannel(1) && channelPortalState[1] ? !!channelPortalState[1].isPlaying : !audioRight.paused;
      var anyPlaying = leftPlaying || rightPlaying;
      dualPlayBtn.innerHTML =
        '<svg class="ionicon beta-dual-play-glyph" width="88" height="88" viewBox="0 0 512 512" aria-hidden="true">' +
        channelPlayIcon(anyPlaying) +
        "</svg>";
      dualPlayBtn.setAttribute("aria-label", anyPlaying ? "Pause both channels" : "Play both channels");
    }
  }

  function refreshChannelUi(chIdx, opts) {
    opts = opts || {};
    renderTitles();
    if (opts.includeSpeed) renderSpeedLabels();
    updatePlayLabels();
    if (opts.includeSeek) updateSeekUi();
    if (opts.includeQueue && queueHolder.api) queueHolder.api.refreshIfOpen();
  }

  function refreshAllUi() {
    renderTitles();
    renderSpeedLabels();
    refreshVolumeInteractivity();
    updatePlayLabels();
    updateSeekUi();
    if (queueHolder.api) queueHolder.api.refreshIfOpen();
  }

  function applyPausedTransport(chIdx) {
    setPlayIntent(chIdx, false);
    pauseLocalChannel(chIdx);
    refreshChannelUi(chIdx, { includeQueue: true });
  }

  function assignAndRefresh(chIdx, opts) {
    return assignAudioFromCurrentIndex(chIdx, opts).then(function () {
      refreshChannelUi(chIdx, { includeQueue: true });
    });
  }

  function seekBySeconds(chIdx, deltaSeconds) {
    var delta = Number.isFinite(deltaSeconds) ? deltaSeconds : 0;
    if (!delta) return;
    if (isPortalChannel(chIdx)) {
      var ps = channelPortalState[chIdx];
      if (!ps || !ps.onSeek) return;
      var cur = Number.isFinite(ps.currentTime) ? ps.currentTime : 0;
      var dur = Number.isFinite(ps.duration) && ps.duration > 0 ? ps.duration : Infinity;
      var next = Math.max(0, Math.min(cur + delta, dur));
      safeCall(ps.onSeek, [next]);
      return;
    }
    ensureGraph()
      .then(function () {
        var a = audios[chIdx];
        var cur = Number.isFinite(a.currentTime) ? a.currentTime : 0;
        var dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : Infinity;
        a.currentTime = Math.max(0, Math.min(cur + delta, dur));
      })
      .catch(function () {});
  }

  function wirePrevNextTapOnly(chIdx, prevEl, nextEl) {
    function bind(btn, direction) {
      if (!btn) return;
      btn.addEventListener("click", function () {
        if (!prevNextTapGuard("skip-" + chIdx + "-" + direction)) return;
        dispatchPortalIntent({
          type: direction < 0 ? Engine.INTENT.QUEUE_PREV : Engine.INTENT.QUEUE_NEXT,
          channel: chIdx,
        });
      });
    }
    bind(prevEl, -1);
    bind(nextEl, 1);
  }

  function wireSeekStepButtons(chIdx, backEl, forwardEl) {
    function bind(btn, delta) {
      if (!btn) return;
      btn.addEventListener("click", function () {
        if (!prevNextTapGuard("seek-step-" + chIdx + "-" + delta)) return;
        seekBySeconds(chIdx, delta);
      });
    }
    bind(backEl, -15);
    bind(forwardEl, 15);
  }

  function bindFileLoad(side, idx, u) {
    if (!u.loadBtn || !u.fileInput) return;
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

  function bindDragAndDrop(side, idx) {
    var segmentEl = document.querySelector('[data-channel="' + side + '"]');
    if (!segmentEl) return;
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

  function bindTransportAndQueue(side, idx, u) {
    if (u.playBtn) {
      u.playBtn.addEventListener("click", function () {
        dispatchPortalIntent({ type: Engine.INTENT.PLAY_PAUSE, channel: idx });
      });
    }
    wirePrevNextTapOnly(idx, u.prev, u.next);
    wireSeekStepButtons(idx, u.seekBack, u.seekForward);
    if (u.queue) {
      u.queue.addEventListener("click", function () {
        if (queueHolder.api) queueHolder.api.open(side);
      });
    }
  }

  function bindSeekVolumePan(idx, u) {
    if (u.seek) {
      u.seek.addEventListener("pointerdown", function () {
        u.seek.dataset.dragging = "1";
      });
      u.seek.addEventListener("pointerup", function () {
        delete u.seek.dataset.dragging;
      });
      u.seek.addEventListener("input", function () {
        var v = parseFloat(u.seek.value);
        if (!Number.isFinite(v)) return;
        getChannelController(idx).seek(v);
      });
    }

    if (u.vol) {
      u.vol.addEventListener("input", function () {
        var v = parseFloat(u.vol.value);
        getChannelController(idx).setVolume(v);
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
  }

  function bindSpeedControl(idx, u) {
    if (!u.speed || !localSpeedStepEnabledEffective) return;
    u.speed.addEventListener("click", function () {
      if (!speedTapGuard("speed-" + idx)) return;
      if (isPortalChannel(idx)) {
        renderSpeedLabels();
        return;
      }
      speedIdx[idx] = (speedIdx[idx] + 1) % speedPresets.length;
      getChannelController(idx).setSpeed(speedPresets[speedIdx[idx]] || 1);
      renderSpeedLabels();
    });
  }

  function wireChannel(side) {
    var u = ui[side];
    var idx = side === "left" ? 0 : 1;
    bindFileLoad(side, idx, u);
    bindDragAndDrop(side, idx);
    bindTransportAndQueue(side, idx, u);
    bindSeekVolumePan(idx, u);
    if (spotifyHolder.api) spotifyHolder.api.bindChannelButton(side, idx);
    bindSpeedControl(idx, u);
  }

  var SpotifyMod = window.dicoticTryPortalSpotify;
  if (SpotifyMod && typeof SpotifyMod.create === "function") {
    spotifyHolder.api = SpotifyMod.create({
      setStatus: setStatus,
      sideToIdx: sideToIdx,
      idxToSide: idxToSide,
      isPortalChannel: isPortalChannel,
      isIOSSpotifyVolumeLocked: isIOSSpotifyVolumeLocked,
      setSideSource: setSideSource,
      updatePortalSideState: updatePortalSideState,
      getPortalState: function (idx) {
        return channelPortalState[idx];
      },
      getVolSliderValue: function (idx) {
        var u = idx === 0 ? ui.left : ui.right;
        var v = u && u.vol ? parseFloat(u.vol.value) : 1;
        return Number.isFinite(v) ? v : 1;
      },
      spotifyButton: function (side) {
        return side === "left" ? ui.left.spotify : ui.right.spotify;
      },
      dom: {
        root: spotifyRoot,
        backdrop: spotifyBackdrop,
        panel: spotifyPanel,
        title: spotifyTitle,
        closeBtn: spotifyCloseBtn,
        transferBtn: spotifyTransferBtn,
        disableBtn: spotifyDisableBtn,
        hint: spotifyHintEl,
      },
    });
    spotifyHolder.api.wireModal();
  }

  var QueueMod = window.dicoticTryPortalQueue;
  if (QueueMod && typeof QueueMod.create === "function") {
    queueHolder.api = QueueMod.create({
      dom: {
        root: queueRoot,
        backdrop: queueBackdrop,
        panel: queuePanel,
        heading: queueHeading,
        list: queueListEl,
        emptyEl: queueEmptyEl,
        shuffleBtn: queueShuffleBtn,
        closeBtn: queueCloseBtn,
        clearBtn: queueClearBtn,
      },
      sideToIdx: sideToIdx,
      isPortalChannel: isPortalChannel,
      getQueue: getQueue,
      getCurrentIndex: function (chIdx) {
        return channelCurrentIndex[chIdx];
      },
      playFromIndex: playFromIndex,
      removeQueueItemAt: removeQueueItemAt,
      reorderQueueItem: reorderQueueItem,
      updateQueueHeaderButtons: updateQueueHeaderButtons,
      toggleShuffleForChannel: toggleShuffleForChannel,
      clearChannelQueue: clearChannelQueue,
    });
    queueHolder.api.wire();
  }

  wireChannel("left");
  wireChannel("right");

  audios.forEach(function (a, idx) {
    a.addEventListener("play", function () {
      channelShouldBePlaying[idx] = true;
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
      dispatchPortalIntent({ type: Engine.INTENT.DUAL_TOGGLE });
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.code !== "Space") return;
    var tg = e.target;
    var qRoot = queueHolder.api ? queueHolder.api.getRoot() : null;
    var sRoot = spotifyHolder.api ? spotifyHolder.api.getRoot() : null;
    if (qRoot && !qRoot.hidden && qRoot.contains(/** @type {Node} */ (tg))) return;
    if (sRoot && !sRoot.hidden && sRoot.contains(/** @type {Node} */ (tg))) return;
    if (tg instanceof HTMLElement && tg.isContentEditable) return;
    if (tg instanceof HTMLInputElement || tg instanceof HTMLTextAreaElement || tg instanceof HTMLSelectElement) {
      if (!(tg instanceof HTMLInputElement) || tg.type !== "range") return;
    }
    e.preventDefault();
    if (dualPlayBtn) dualPlayBtn.click();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var qRoot = queueHolder.api ? queueHolder.api.getRoot() : null;
    var sRoot = spotifyHolder.api ? spotifyHolder.api.getRoot() : null;
    if (queueHolder.api && qRoot && !qRoot.hidden) queueHolder.api.close();
    if (spotifyHolder.api && sRoot && !sRoot.hidden) spotifyHolder.api.closeSheet();
  });

  document.body.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!(t instanceof Element)) return;
    var guard = t.closest(".beta-disabled-guard--locked");
    if (!guard) return;
    var tip = guard.getAttribute("data-beta-tip") || guard.getAttribute("title") || "";
    if (!tip) return;
    setStatus(tip, false);
  });

  function applyChannelPlayPauseIntent(idx) {
    if (typeof idx !== "number" || idx < 0 || idx > 1) return;
    if (!mainPlayTapGuard("play-" + idx)) return;
    var controller = getChannelController(idx);
    controller.playPause(!controller.isPlaying()).catch(function () {
      setStatus("Playback blocked until you interact with the page.", true);
    });
  }

  function applyDualPlayToggleIntent() {
    var leftController = getChannelController(0);
    var rightController = getChannelController(1);
    var leftPlaying = leftController.isPlaying();
    var rightPlaying = rightController.isPlaying();
    var anyPlaying = leftPlaying || rightPlaying;
    if (anyPlaying) {
      leftController.playPause(false);
      rightController.playPause(false);
      updatePlayLabels();
      return;
    }
    if (!mainPlayTapGuard("dual-play")) return;
    Promise.all([leftController.playPause(true), rightController.playPause(true)])
      .catch(function () {
        setStatus("Playback blocked or no audio loaded.", true);
      })
      .catch(function () {});
  }

  function dispatchPortalIntent(intent) {
    if (!intent || !intent.type || !Engine.INTENT) return;
    switch (intent.type) {
      case Engine.INTENT.SHUFFLE_TOGGLE: {
        var ch = queueHolder.api ? queueHolder.api.getPanelChannel() : null;
        if (ch) toggleShuffleForChannel(sideToIdx(ch));
        break;
      }
      case Engine.INTENT.PLAY_PAUSE:
        applyChannelPlayPauseIntent(intent.channel);
        break;
      case Engine.INTENT.DUAL_TOGGLE:
        applyDualPlayToggleIntent();
        break;
      case Engine.INTENT.SWAP_CHANNELS:
        if (!mainPlayTapGuard("swap-queues")) break;
        ensureGraph()
          .then(function () {
            return swapQueues();
          })
          .catch(function () {});
        break;
      case Engine.INTENT.QUEUE_PREV:
        if (typeof intent.channel !== "number" || intent.channel < 0 || intent.channel > 1) break;
        getChannelController(intent.channel).queuePrev();
        break;
      case Engine.INTENT.QUEUE_NEXT:
        if (typeof intent.channel !== "number" || intent.channel < 0 || intent.channel > 1) break;
        getChannelController(intent.channel).queueNext();
        break;
      default:
        break;
    }
  }

  /** @param {0|1} chIdx */
  function readChannelSwapSlice(chIdx) {
    var u = chIdx === 0 ? ui.left : ui.right;
    return {
      queueFiles: channelQueueFiles[chIdx],
      currentIndex: channelCurrentIndex[chIdx],
      shuffleEnabled: channelShuffleEnabled[chIdx],
      lastBlobUrl: channelLastBlobUrl[chIdx],
      sourceKind: channelSourceKind[chIdx],
      portalState: normalizePortalState(channelPortalState[chIdx], "portal"),
      trackMeta: { title: trackMeta[chIdx].title, artist: trackMeta[chIdx].artist || "" },
      speedIdx: speedIdx[chIdx],
      volValue: u && u.vol ? u.vol.value : "1",
      panValue: u && u.pan ? u.pan.value : chIdx === 0 ? "-1" : "1",
      playingIntent: channelShouldBePlaying[chIdx],
    };
  }

  /** @param {0|1} chIdx @param {Object} S slice from engine.swapChannelSlices */
  function applyChannelSwapSlice(chIdx, S) {
    channelQueueFiles[chIdx] = S.queueFiles;
    channelCurrentIndex[chIdx] = S.currentIndex;
    channelShuffleEnabled[chIdx] = S.shuffleEnabled;
    channelLastBlobUrl[chIdx] = S.lastBlobUrl;
    channelSourceKind[chIdx] = S.sourceKind;
    channelPortalState[chIdx] = S.portalState;
    trackMeta[chIdx] = S.trackMeta;
    speedIdx[chIdx] = S.speedIdx;
    if (!localSpeedStepEnabledEffective) speedIdx[chIdx] = 1;
    var u = chIdx === 0 ? ui.left : ui.right;
    if (u && u.vol) u.vol.value = S.volValue;
    setPanInputValue(u && u.pan, S.panValue);
    channelShouldBePlaying[chIdx] = S.playingIntent;
  }

  function swapQueues() {
    if (swapInFlight) return Promise.resolve();
    swapInFlight = true;
    var al = audioLeft;
    var ar = audioRight;
    var srcL = al.src;
    var srcR = ar.src;
    var tL = al.currentTime;
    var tR = ar.currentTime;
    var pausedL = al.paused;
    var pausedR = ar.paused;
    var kindL = channelSourceKind[0];
    var kindR = channelSourceKind[1];

    var sliceL = readChannelSwapSlice(0);
    var sliceR = readChannelSwapSlice(1);
    var swapped =
      typeof Engine.swapChannelSlices === "function" ? Engine.swapChannelSlices(sliceL, sliceR) : { left: sliceR, right: sliceL };
    // Mirror pans while swapping sides so audio exits the opposite speaker as expected.
    swapped.left.panValue = String(mirrorPanValue(sliceR.panValue, 1));
    swapped.right.panValue = String(mirrorPanValue(sliceL.panValue, -1));
    applyChannelSwapSlice(0, swapped.left);
    applyChannelSwapSlice(1, swapped.right);

    channelLoadRequestId[0] += 1;
    channelLoadRequestId[1] += 1;
    channelPlayIntentToken[0] += 1;
    channelPlayIntentToken[1] += 1;
    var swapIntentTokenLeft = channelPlayIntentToken[0];
    var swapIntentTokenRight = channelPlayIntentToken[1];
    al.pause();
    ar.pause();
    function bindSideAudioFromSnapshot(destIdx) {
      var movedFrom = destIdx === 0 ? 1 : 0;
      var destAudio = destIdx === 0 ? al : ar;
      var movedSrc = movedFrom === 0 ? srcL : srcR;
      var movedTime = movedFrom === 0 ? tL : tR;
      var movedPaused = movedFrom === 0 ? pausedL : pausedR;
      var movedKind = movedFrom === 0 ? kindL : kindR;
      if (channelSourceKind[destIdx] !== "local") {
        destAudio.removeAttribute("src");
        destAudio.load();
        applyLocalRateToAudio(destAudio, 1);
        return {
          shouldResume: movedKind === "portal" && !movedPaused,
          intentToken: destIdx === 0 ? swapIntentTokenLeft : swapIntentTokenRight,
        };
      }
      if (movedKind !== "local" || !movedSrc) {
        if (!getCurrentFile(destIdx)) {
          destAudio.removeAttribute("src");
          destAudio.load();
          trackMeta[destIdx] = { title: "No track loaded", artist: "" };
          return { shouldResume: false };
        }
        return { shouldRebindFromQueue: true };
      }
      destAudio.src = movedSrc;
      var bindRate = localSpeedStepEnabledEffective ? speedPresets[speedIdx[destIdx]] || 1 : 1;
      applyLocalRateToAudio(destAudio, Number.isFinite(bindRate) ? bindRate : 1);
      return {
        shouldResume: !movedPaused,
        seekTo: movedTime,
        intentToken: destIdx === 0 ? swapIntentTokenLeft : swapIntentTokenRight,
      };
    }

    function finish() {
      var leftBinding = bindSideAudioFromSnapshot(0);
      var rightBinding = bindSideAudioFromSnapshot(1);
      var prep = [];
      if (leftBinding && leftBinding.shouldRebindFromQueue) {
        prep.push(assignAudioFromCurrentIndex(0, { doPlay: false }));
      }
      if (rightBinding && rightBinding.shouldRebindFromQueue) {
        prep.push(assignAudioFromCurrentIndex(1, { doPlay: false }));
      }
      return Promise.all(prep)
        .then(function () {
          if (leftBinding && Number.isFinite(leftBinding.seekTo) && al.src) {
            try {
              al.currentTime = leftBinding.seekTo;
            } catch (e) {}
          }
          if (rightBinding && Number.isFinite(rightBinding.seekTo) && ar.src) {
            try {
              ar.currentTime = rightBinding.seekTo;
            } catch (e2) {}
          }

          syncLocalPlaybackRate(0);
          syncLocalPlaybackRate(1);
          refreshAllUi();
          applyChannelVolumeToGraph(0);
          applyChannelVolumeToGraph(1);
          applyPansToGraph();

          getChannelController(0).swapToSide(idxToSide(0));
          getChannelController(1).swapToSide(idxToSide(1));

          if (leftBinding && leftBinding.shouldResume && channelShouldBePlaying[0] && currentPlayIntentToken(0) === leftBinding.intentToken) {
            if (channelSourceKind[0] === "portal") {
              var leftPortalState = channelPortalState[0];
              if (leftPortalState && leftPortalState.onPlayPause) safeCall(leftPortalState.onPlayPause, [true]);
            } else if (al.src) {
              al.play().catch(function () {});
            }
          }
          if (rightBinding && rightBinding.shouldResume && channelShouldBePlaying[1] && currentPlayIntentToken(1) === rightBinding.intentToken) {
            if (channelSourceKind[1] === "portal") {
              var rightPortalState = channelPortalState[1];
              if (rightPortalState && rightPortalState.onPlayPause) safeCall(rightPortalState.onPlayPause, [true]);
            } else if (ar.src) {
              ar.play().catch(function () {});
            }
          }
        })
        .catch(function () {
          syncLocalPlaybackRate(0);
          syncLocalPlaybackRate(1);
          refreshAllUi();
          applyChannelVolumeToGraph(0);
          applyChannelVolumeToGraph(1);
          applyPansToGraph();
        });
    }
    return finish().finally(function () {
      swapInFlight = false;
    });
  }

  if (swapBtn) {
    swapBtn.addEventListener("click", function () {
      dispatchPortalIntent({ type: Engine.INTENT.SWAP_CHANNELS });
    });
  }

  function setSideSource(side, descriptor) {
    var chIdx = sideToIdx(side);
    var normalized = normalizePortalState(descriptor);
    channelSourceKind[chIdx] = normalized.sourceKind;
    channelLoadRequestId[chIdx] += 1;
    channelPlayIntentToken[chIdx] += 1;
    if (normalized.sourceKind === "portal") {
      channelPortalState[chIdx] = normalizePortalState(normalized, "portal");
      channelShouldBePlaying[chIdx] = !!normalized.isPlaying;
      pauseLocalChannel(chIdx);
      audios[chIdx].removeAttribute("src");
      audios[chIdx].load();
    } else {
      channelPortalState[chIdx] = null;
      channelShouldBePlaying[chIdx] = false;
      if (localSpeedStepEnabledEffective && Number.isFinite(normalized.playbackRate)) {
        applyLocalRateToAudio(audios[chIdx], normalized.playbackRate);
      } else {
        applyLocalRateToAudio(audios[chIdx], 1);
      }
      if (!audios[chIdx].src && getCurrentFile(chIdx)) {
        assignAudioFromCurrentIndex(chIdx, { doPlay: false });
      }
    }
    refreshAllUi();
    if (spotifyHolder.api) spotifyHolder.api.refreshButtons();
  }

  function updatePortalSideState(side, patch) {
    var chIdx = sideToIdx(side);
    if (channelSourceKind[chIdx] !== "portal") return;
    var current = normalizePortalState(channelPortalState[chIdx], "portal") || normalizePortalState({ sourceKind: "portal" });
    var next = Object.assign({}, current, patch || {});
    channelPortalState[chIdx] = normalizePortalState(Object.assign({}, next, { sourceKind: "portal" }), "portal");
    refreshChannelUi(chIdx, { includeSpeed: true, includeSeek: true });
  }

  if (spotifyHolder.api) {
    spotifyHolder.api
      .initAuthFromUrl()
      .then(function () {})
      .catch(function () {});
  }

  requestAnimationFrame(loopSeek);
  refreshChannelUi(0, { includeSpeed: true });
  refreshVolumeInteractivity();
  if (spotifyHolder.api) spotifyHolder.api.refreshButtons();
})();
