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
  var speedTapGuard =
    localSpeedStepEnabled && typeof Engine.createTapGuard === "function"
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
  var SPOTIFY_REDIRECT_URI = "https://dicotic.com/try/";
  var SPOTIFY_SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
  ].join(" ");

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

  /** Which channel queue UI is showing, or null if closed. */
  var queuePanelChannel = /** @type {ChannelSide | null} */ (null);

  var speedPresets = [0.75, 1, 1.25, 1.5];
  var speedIdx = [1, 1];

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

  var spotifyRuntime = {
    sdkPromise: null,
    player: null,
    deviceId: "",
    activeSide: /** @type {ChannelSide | null} */ (null),
    lastState: null,
    lastStateAtMs: 0,
    basePositionSec: 0,
    ticker: null,
    tokenValue: "",
    tokenExpiresAt: 0,
    transferBusy: false,
    modalSide: /** @type {ChannelSide | null} */ (null),
    modalLoading: false,
    modalError: "",
  };
  var spotifyAuth = {
    accessToken: "",
    refreshToken: "",
    expiresAt: 0,
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
          return setSpotifyVolumeFromChannel(chIdx, clamped);
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

  function clonePortalState(ps) {
    if (!ps) return null;
    return {
      title: ps.title || "",
      artist: ps.artist || "",
      isPlaying: !!ps.isPlaying,
      currentTime: Number.isFinite(ps.currentTime) ? ps.currentTime : 0,
      duration: Number.isFinite(ps.duration) ? ps.duration : 0,
      playbackRate: Number.isFinite(ps.playbackRate) && ps.playbackRate > 0 ? ps.playbackRate : 1,
      canSeek: ps.canSeek !== false,
      onPlayPause: typeof ps.onPlayPause === "function" ? ps.onPlayPause : null,
      onSeek: typeof ps.onSeek === "function" ? ps.onSeek : null,
      onNext: typeof ps.onNext === "function" ? ps.onNext : null,
      onPrev: typeof ps.onPrev === "function" ? ps.onPrev : null,
      onSetSpeed: typeof ps.onSetSpeed === "function" ? ps.onSetSpeed : null,
      onSwapToSide: typeof ps.onSwapToSide === "function" ? ps.onSwapToSide : null,
    };
  }

  function safeCall(fn, args) {
    if (typeof fn !== "function") return;
    try {
      fn.apply(null, args || []);
    } catch (err) {}
  }

  function getSpotifyConfig() {
    var conf = window.dicoticSpotifyConfig;
    return conf && typeof conf === "object" ? conf : {};
  }

  function getSdkGlobal() {
    return window.Spotify || null;
  }

  function getSpotifyClientId() {
    var id = "";
    if (typeof window !== "undefined" && window.__SPOTIFY_CLIENT_ID__) {
      id = String(window.__SPOTIFY_CLIENT_ID__);
    }
    if (!id && typeof window !== "undefined" && window.SPOTIFY_CLIENT_ID) {
      id = String(window.SPOTIFY_CLIENT_ID);
    }
    return id.trim();
  }

  function base64UrlEncode(bytes) {
    var str = "";
    for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function randomVerifier(len) {
    var arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return base64UrlEncode(arr);
  }

  function sha256Base64Url(input) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)).then(function (hash) {
      return base64UrlEncode(new Uint8Array(hash));
    });
  }

  function spotifyStorageKey(name) {
    return "dicotic_spotify_" + name;
  }

  function loadSpotifyAuthFromStorage() {
    try {
      var raw = sessionStorage.getItem(spotifyStorageKey("auth"));
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      spotifyAuth.accessToken = parsed.accessToken || "";
      spotifyAuth.refreshToken = parsed.refreshToken || "";
      spotifyAuth.expiresAt = parsed.expiresAt || 0;
    } catch (e) {}
  }

  function saveSpotifyAuthToStorage() {
    try {
      sessionStorage.setItem(spotifyStorageKey("auth"), JSON.stringify(spotifyAuth));
    } catch (e) {}
  }

  function syncSpotifyRuntimeToken() {
    spotifyRuntime.tokenValue = spotifyAuth.accessToken || "";
    spotifyRuntime.tokenExpiresAt = Number.isFinite(spotifyAuth.expiresAt) ? spotifyAuth.expiresAt : 0;
  }

  function clearSpotifyAuth() {
    spotifyAuth.accessToken = "";
    spotifyAuth.refreshToken = "";
    spotifyAuth.expiresAt = 0;
    syncSpotifyRuntimeToken();
    try {
      sessionStorage.removeItem(spotifyStorageKey("auth"));
    } catch (e) {}
  }

  function getRuntimeRedirectUri() {
    if (typeof window === "undefined") return SPOTIFY_REDIRECT_URI;
    var p = window.location.protocol + "//" + window.location.host + window.location.pathname;
    if (p.indexOf("/try/") >= 0) return p;
    return SPOTIFY_REDIRECT_URI;
  }

  function isAuthMissingError(err) {
    if (!err || !err.message) return false;
    return err.message === "no spotify auth";
  }

  function spotifyAuthStart(side) {
    var clientId = getSpotifyClientId();
    if (!clientId) {
      setStatus("Spotify client ID is missing. Set window.__SPOTIFY_CLIENT_ID__.", true);
      return Promise.reject(new Error("missing client id"));
    }
    var verifier = randomVerifier(64);
    return sha256Base64Url(verifier).then(function (challenge) {
      var redirectUri = getRuntimeRedirectUri();
      var state = randomVerifier(24);
      sessionStorage.setItem(spotifyStorageKey("pkce_verifier"), verifier);
      sessionStorage.setItem(spotifyStorageKey("oauth_state"), state);
      if (side === "left" || side === "right") {
        sessionStorage.setItem(spotifyStorageKey("pending_side"), side);
      }
      var qs = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        scope: SPOTIFY_SCOPES,
        redirect_uri: redirectUri,
        code_challenge_method: "S256",
        code_challenge: challenge,
        state: state,
      });
      window.location.assign("https://accounts.spotify.com/authorize?" + qs.toString());
    });
  }

  function exchangeSpotifyCodeForToken(code) {
    var verifier = sessionStorage.getItem(spotifyStorageKey("pkce_verifier")) || "";
    var clientId = getSpotifyClientId();
    if (!verifier || !clientId) return Promise.reject(new Error("missing verifier or client id"));
    var redirectUri = getRuntimeRedirectUri();
    var body = new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    return fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }).then(function (r) {
      if (!r.ok) throw new Error("token exchange failed");
      return r.json();
    });
  }

  function refreshSpotifyToken() {
    if (!spotifyAuth.refreshToken) return Promise.reject(new Error("missing refresh token"));
    var clientId = getSpotifyClientId();
    var body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: spotifyAuth.refreshToken,
      client_id: clientId,
    });
    return fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }).then(function (r) {
      if (!r.ok) throw new Error("token refresh failed");
      return r.json();
    });
  }

  function applyTokenPayload(payload) {
    spotifyAuth.accessToken = payload.access_token || "";
    if (payload.refresh_token) spotifyAuth.refreshToken = payload.refresh_token;
    var expiresIn = Number(payload.expires_in || 3600);
    spotifyAuth.expiresAt = Date.now() + Math.max(60, expiresIn - 30) * 1000;
    saveSpotifyAuthToStorage();
    syncSpotifyRuntimeToken();
  }

  function ensureSpotifyToken() {
    if (spotifyAuth.accessToken && Date.now() < spotifyAuth.expiresAt) {
      syncSpotifyRuntimeToken();
      return Promise.resolve(spotifyAuth.accessToken);
    }
    if (spotifyAuth.refreshToken) {
      return refreshSpotifyToken()
        .then(function (payload) {
          applyTokenPayload(payload);
          return spotifyAuth.accessToken;
        })
        .catch(function () {
          clearSpotifyAuth();
          throw new Error("no spotify auth");
        });
    }
    return Promise.reject(new Error("no spotify auth"));
  }

  function initSpotifyAuthFromUrl() {
    loadSpotifyAuthFromStorage();
    syncSpotifyRuntimeToken();
    var params = new URLSearchParams(window.location.search);
    var code = params.get("code");
    var state = params.get("state");
    if (!code) return Promise.resolve();
    var expectedState = sessionStorage.getItem(spotifyStorageKey("oauth_state")) || "";
    if (!state || !expectedState || state !== expectedState) {
      setStatus("Spotify login failed. Try again.", true);
      return Promise.resolve();
    }
    return exchangeSpotifyCodeForToken(code)
      .then(function (payload) {
        applyTokenPayload(payload);
        sessionStorage.removeItem(spotifyStorageKey("pkce_verifier"));
        sessionStorage.removeItem(spotifyStorageKey("oauth_state"));
        var side = sessionStorage.getItem(spotifyStorageKey("pending_side"));
        sessionStorage.removeItem(spotifyStorageKey("pending_side"));
        params.delete("code");
        params.delete("state");
        var next = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
        window.history.replaceState({}, document.title, next);
        if (side === "left" || side === "right") {
          return enableSpotifyOnSide(side);
        }
      })
      .catch(function () {
        setStatus("Spotify login failed. Try again.", true);
      });
  }

  function setSpotifyBtnState(side, isActive, isBusy) {
    var btn = side === "left" ? ui.left.spotify : ui.right.spotify;
    if (!btn) return;
    btn.classList.toggle("beta-small-btn--active", !!isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    btn.disabled = !!isBusy;
    btn.setAttribute("aria-label", (isActive ? "Disable" : "Enable") + " Spotify on " + side + " channel");
  }

  function refreshSpotifyButtons() {
    var active = spotifyRuntime.activeSide;
    setSpotifyBtnState("left", active === "left" && isPortalChannel(0), false);
    setSpotifyBtnState("right", active === "right" && isPortalChannel(1), false);
  }

  function readTrackFromState(state) {
    var tw = state && state.track_window ? state.track_window : null;
    var cur = tw && tw.current_track ? tw.current_track : null;
    var artists = cur && cur.artists && cur.artists.length ? cur.artists.map(function (a) { return a && a.name ? a.name : ""; }).filter(Boolean).join(", ") : "";
    return {
      title: cur && cur.name ? cur.name : "Spotify portal",
      artist: artists || "",
      duration: cur && Number.isFinite(cur.duration_ms) ? cur.duration_ms / 1000 : 0,
      currentTime: state && Number.isFinite(state.position) ? state.position / 1000 : 0,
      isPlaying: !!(state && state.paused === false),
    };
  }

  function stopSpotifyTicker() {
    if (spotifyRuntime.ticker !== null) {
      clearInterval(spotifyRuntime.ticker);
      spotifyRuntime.ticker = null;
    }
  }

  function computeSpotifyPatchFromRuntime() {
    if (!spotifyRuntime.lastState) return null;
    var patch = readTrackFromState(spotifyRuntime.lastState);
    var base = Number.isFinite(spotifyRuntime.basePositionSec) ? spotifyRuntime.basePositionSec : patch.currentTime;
    if (!Number.isFinite(base) || base < 0) base = 0;
    if (patch.isPlaying && spotifyRuntime.lastStateAtMs > 0) {
      var elapsedSec = Math.max(0, (Date.now() - spotifyRuntime.lastStateAtMs) / 1000);
      patch.currentTime = base + elapsedSec;
    } else {
      patch.currentTime = base;
    }
    var duration = Number.isFinite(patch.duration) ? patch.duration : 0;
    if (duration > 0 && patch.currentTime > duration) patch.currentTime = duration;
    if (patch.currentTime < 0) patch.currentTime = 0;
    return patch;
  }

  function startSpotifyTicker() {
    stopSpotifyTicker();
    spotifyRuntime.ticker = setInterval(function () {
      if (!spotifyRuntime.lastState || !spotifyRuntime.activeSide) return;
      var side = spotifyRuntime.activeSide;
      var idx = sideToIdx(side);
      if (!isPortalChannel(idx)) return;
      var patch = computeSpotifyPatchFromRuntime();
      if (!patch) return;
      var existing = channelPortalState[idx];
      if (patch.isPlaying && existing && Number.isFinite(existing.currentTime) && patch.currentTime < existing.currentTime) {
        patch.currentTime = existing.currentTime;
      }
      updatePortalSideState(side, patch);
    }, 500);
  }

  function applySpotifyStateToActiveSide() {
    if (!spotifyRuntime.activeSide || !spotifyRuntime.lastState) return;
    var side = spotifyRuntime.activeSide;
    var idx = sideToIdx(side);
    if (!isPortalChannel(idx)) return;
    var patch = computeSpotifyPatchFromRuntime();
    if (!patch) return;
    patch.playbackRate = 1;
    patch.canSeek = true;
    updatePortalSideState(side, patch);
    if (patch.isPlaying) startSpotifyTicker();
    else stopSpotifyTicker();
  }

  function getSpotifyToken() {
    var now = Date.now();
    if (spotifyRuntime.tokenValue && spotifyRuntime.tokenExpiresAt > now + 5000) {
      return Promise.resolve(spotifyRuntime.tokenValue);
    }
    var conf = getSpotifyConfig();
    if (typeof conf.getAccessToken === "function") {
      return Promise.resolve()
        .then(function () {
          return conf.getAccessToken();
        })
        .then(function (result) {
          if (typeof result === "string") {
            spotifyRuntime.tokenValue = result;
            spotifyRuntime.tokenExpiresAt = now + 50 * 60 * 1000;
            return spotifyRuntime.tokenValue;
          }
          if (result && typeof result.token === "string") {
            spotifyRuntime.tokenValue = result.token;
            var ttlSec = Number.isFinite(result.expiresInSec) ? result.expiresInSec : 3000;
            spotifyRuntime.tokenExpiresAt = now + Math.max(60, ttlSec) * 1000;
            return spotifyRuntime.tokenValue;
          }
          throw new Error("Spotify token provider returned invalid payload");
        });
    }
    return ensureSpotifyToken().then(function (token) {
      spotifyRuntime.tokenValue = token;
      spotifyRuntime.tokenExpiresAt = spotifyAuth.expiresAt || now + 60 * 1000;
      return token;
    });
  }

  function spotifyApiFetch(path, init) {
    return getSpotifyToken().then(function (token) {
      var reqInit = Object.assign({}, init || {});
      var headers = Object.assign({}, reqInit.headers || {}, {
        Authorization: "Bearer " + token,
      });
      if (reqInit.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      reqInit.headers = headers;
      return fetch("https://api.spotify.com/v1" + path, reqInit).then(function (res) {
        if (res.status === 401) {
          clearSpotifyAuth();
          throw new Error("spotify_scope_or_auth");
        }
        if (!res.ok) {
          return res
            .text()
            .then(function (bodyText) {
              var bodyMsg = "";
              if (bodyText) {
                var compact = bodyText.replace(/\s+/g, " ").trim();
                if (compact) bodyMsg = ": " + compact.slice(0, 220);
              }
              throw new Error("spotify api " + res.status + bodyMsg);
            })
            .catch(function (err) {
              if (err && err.message) throw err;
              throw new Error("spotify api " + res.status);
            });
        }
        if (res.status === 204) return null;
        return res.json();
      });
    });
  }

  function waitForSpotifyDeviceId(timeoutMs) {
    var maxWait = Number.isFinite(timeoutMs) ? timeoutMs : 4000;
    if (spotifyRuntime.deviceId) return Promise.resolve(spotifyRuntime.deviceId);
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      var t = setInterval(function () {
        if (spotifyRuntime.deviceId) {
          clearInterval(t);
          resolve(spotifyRuntime.deviceId);
          return;
        }
        if (Date.now() - started >= maxWait) {
          clearInterval(t);
          reject(new Error("spotify device unavailable"));
        }
      }, 120);
    });
  }

  function transferSpotifyPlayback(deviceId, shouldPlay) {
    var did = deviceId || spotifyRuntime.deviceId;
    if (!did) return Promise.reject(new Error("missing spotify device"));
    return spotifyApiFetch("/me/player", {
      method: "PUT",
      body: JSON.stringify({
        device_ids: [did],
        play: !!shouldPlay,
      }),
    });
  }

  function setSpotifyDeviceVolume(clamped, opts) {
    var volumePercent = Math.round(Math.max(0, Math.min(1, clamped)) * 100);
    var query = "?volume_percent=" + volumePercent;
    var did = opts && opts.deviceId ? String(opts.deviceId) : "";
    if (did) query += "&device_id=" + encodeURIComponent(did);
    return spotifyApiFetch("/me/player/volume" + query, { method: "PUT" });
  }

  function setSpotifyVolumeFromChannel(idx, nextVolume) {
    var clamped = Number.isFinite(nextVolume) ? Math.max(0, Math.min(1, nextVolume)) : 1;
    var side = idxToSide(idx);
    var tasks = [];
    if (spotifyRuntime.player && typeof spotifyRuntime.player.setVolume === "function") {
      tasks.push(spotifyRuntime.player.setVolume(clamped));
    }
    // API fallback keeps device volume in sync when SDK volume alone is not enough.
    tasks.push(
      setSpotifyDeviceVolume(clamped, { deviceId: spotifyRuntime.deviceId }).catch(function () {
        return setSpotifyDeviceVolume(clamped);
      }),
    );
    return Promise.allSettled(tasks).then(function (results) {
      for (var i = 0; i < results.length; i++) {
        if (results[i].status === "fulfilled") return;
      }
      var reason = "spotify volume update failed";
      var first = results[0];
      if (first && first.reason && first.reason.message) reason = first.reason.message;
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[Spotify volume]", side, clamped, reason);
      }
    });
  }

  function setSpotifyModalLoading(isLoading) {
    spotifyRuntime.modalLoading = !!isLoading;
    if (spotifyTransferBtn) spotifyTransferBtn.disabled = spotifyRuntime.modalLoading;
    if (spotifyDisableBtn) spotifyDisableBtn.disabled = spotifyRuntime.modalLoading;
    if (spotifyHintEl) {
      if (spotifyRuntime.modalLoading) spotifyHintEl.textContent = "Working…";
      else if (spotifyRuntime.modalError) spotifyHintEl.textContent = spotifyRuntime.modalError;
      else {
        var side = spotifyRuntime.modalSide;
        var idx = side ? sideToIdx(side) : -1;
        if (idx >= 0 && isIOSSpotifyVolumeLocked(idx)) {
          spotifyHintEl.textContent =
            "On iOS, Spotify volume is controlled by hardware buttons or the Spotify app. Channel volume slider is disabled.";
        } else {
          spotifyHintEl.textContent =
            "Connect sends playback to this browser. Use channel controls for play, pause, seek, and queue.";
        }
      }
    }
  }

  function renderSpotifyModalTitle(side) {
    if (!spotifyTitle) return;
    var isLeft = side === "left";
    spotifyTitle.innerHTML =
      '<span class="beta-spotify-title-side ' +
      (isLeft ? "beta-spotify-title-side--left" : "beta-spotify-title-side--right") +
      '">' +
      (isLeft ? "Left" : "Right") +
      '</span><span class="beta-spotify-title-sep">:</span><span class="beta-spotify-title-brand">Spotify</span>';
    spotifyTitle.setAttribute("aria-label", (isLeft ? "Left" : "Right") + ": Spotify");
  }

  function closeSpotifySheet() {
    if (!spotifyRoot) return;
    spotifyRoot.hidden = true;
    spotifyRoot.setAttribute("aria-hidden", "true");
    document.body.classList.remove("beta-spotify-open");
    spotifyRuntime.modalSide = null;
    spotifyRuntime.modalError = "";
    setSpotifyModalLoading(false);
  }

  function openSpotifySheet(side) {
    if (!spotifyRoot) return;
    spotifyRuntime.modalSide = side;
    spotifyRuntime.modalError = "";
    if (spotifyPanel) spotifyPanel.setAttribute("data-channel", side);
    renderSpotifyModalTitle(side);
    spotifyRoot.hidden = false;
    spotifyRoot.setAttribute("aria-hidden", "false");
    document.body.classList.add("beta-spotify-open");
    setSpotifyModalLoading(false);
    if (spotifyHintEl) {
      var idx = sideToIdx(side);
      if (isIOSSpotifyVolumeLocked(idx)) {
        spotifyHintEl.textContent =
          "On iOS, Spotify volume is controlled by hardware buttons or the Spotify app. Channel volume slider is disabled.";
      } else {
        spotifyHintEl.textContent =
          "Connect sends playback to this browser. Use channel controls for play, pause, seek, and queue.";
      }
    }
  }

  function transferPlaybackToCurrentDevice(silent) {
    if (spotifyRuntime.transferBusy) return Promise.resolve();
    spotifyRuntime.transferBusy = true;
    return waitForSpotifyDeviceId(5000)
      .then(function (did) {
        return transferSpotifyPlayback(did, false);
      })
      .then(function () {
        if (!silent) setStatus("Spotify transferred to this device.", false);
      })
      .catch(function (err) {
        var reason = err && err.message ? err.message : "unknown";
        if (typeof console !== "undefined" && console.error) {
          console.error("[Spotify transfer failure]", reason, err);
        }
        if (err && err.message === "spotify_scope_or_auth") {
          setStatus("Spotify permissions changed. Please sign in again.", true);
          return;
        }
        if (reason.indexOf("spotify api 403") === 0) {
          setStatus("Spotify rejected transfer (403). Premium/device permissions may block Web Playback.", true);
          if (spotifyRuntime.activeSide) openSpotifySheet(spotifyRuntime.activeSide);
          return;
        }
        if (!silent) {
          setStatus("Transfer failed (" + reason + "). Use Transfer in Spotify sheet.", true);
          if (spotifyRuntime.activeSide) openSpotifySheet(spotifyRuntime.activeSide);
        }
      })
      .finally(function () {
        spotifyRuntime.transferBusy = false;
      });
  }

  function loadSpotifySdk() {
    if (getSdkGlobal()) return Promise.resolve(getSdkGlobal());
    if (spotifyRuntime.sdkPromise) return spotifyRuntime.sdkPromise;
    spotifyRuntime.sdkPromise = new Promise(function (resolve, reject) {
      var existing = document.getElementById("spotify-player-sdk");
      if (existing) {
        existing.addEventListener("load", function () {
          resolve(getSdkGlobal());
        });
        existing.addEventListener("error", function () {
          reject(new Error("Spotify SDK script failed"));
        });
        return;
      }
      var script = document.createElement("script");
      script.id = "spotify-player-sdk";
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      window.onSpotifyWebPlaybackSDKReady = function () {
        resolve(getSdkGlobal());
      };
      script.addEventListener("error", function () {
        reject(new Error("Failed to load Spotify SDK"));
      });
      document.head.appendChild(script);
    });
    return spotifyRuntime.sdkPromise;
  }

  /** Portal channel: see `dicoticPortalEngine.SPOTIFY_CHANNEL` for capability flags (speed, volume). */
  function buildSpotifyPortalDescriptor() {
    return {
      sourceKind: "portal",
      title: "Spotify portal",
      artist: "",
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRate: 1,
      canSeek: true,
      onPlayPause: function (nextPlaying) {
        if (!spotifyRuntime.player) return;
        if (nextPlaying) spotifyRuntime.player.resume();
        else spotifyRuntime.player.pause();
      },
      onSeek: function (seconds) {
        if (!spotifyRuntime.player || !Number.isFinite(seconds)) return;
        spotifyRuntime.player.seek(Math.floor(Math.max(0, seconds) * 1000));
      },
      onNext: function () {
        if (!spotifyRuntime.player) return;
        spotifyRuntime.player.nextTrack();
      },
      onPrev: function () {
        if (!spotifyRuntime.player) return;
        spotifyRuntime.player.previousTrack();
      },
      onSetSpeed: function () {},
      onSwapToSide: function (nextSide) {
        spotifyRuntime.activeSide = nextSide;
        refreshSpotifyButtons();
        applySpotifyStateToActiveSide();
      },
    };
  }

  function initSpotifyPlayer() {
    if (spotifyRuntime.player) return Promise.resolve(spotifyRuntime.player);
    return loadSpotifySdk().then(function (SpotifyNS) {
      if (!SpotifyNS || typeof SpotifyNS.Player !== "function") {
        throw new Error("Spotify SDK unavailable");
      }
      var conf = getSpotifyConfig();
      var playerName = conf.playerName || "dicotic Web beta";
      spotifyRuntime.player = new SpotifyNS.Player({
        name: playerName,
        getOAuthToken: function (cb) {
          getSpotifyToken()
            .then(function (token) {
              cb(token);
            })
            .catch(function () {
              cb("");
            });
        },
        volume: 0.8,
      });

      spotifyRuntime.player.addListener("ready", function (payload) {
        spotifyRuntime.deviceId = payload && payload.device_id ? payload.device_id : "";
        setStatus("Spotify player ready. Transfer playback to this device in Spotify.", false);
      });
      spotifyRuntime.player.addListener("not_ready", function () {
        spotifyRuntime.deviceId = "";
      });
      spotifyRuntime.player.addListener("player_state_changed", function (state) {
        spotifyRuntime.lastState = state || null;
        spotifyRuntime.lastStateAtMs = Date.now();
        spotifyRuntime.basePositionSec = state && Number.isFinite(state.position) ? state.position / 1000 : 0;
        applySpotifyStateToActiveSide();
      });
      spotifyRuntime.player.addListener("authentication_error", function (e) {
        clearSpotifyAuth();
        setStatus("Spotify auth error: " + (e && e.message ? e.message : "unknown"), true);
      });
      spotifyRuntime.player.addListener("account_error", function (e2) {
        setStatus("Spotify account error: " + (e2 && e2.message ? e2.message : "Premium required"), true);
      });
      spotifyRuntime.player.addListener("initialization_error", function (e3) {
        setStatus("Spotify init error: " + (e3 && e3.message ? e3.message : "unknown"), true);
      });
      spotifyRuntime.player.addListener("playback_error", function (e4) {
        setStatus("Spotify playback error: " + (e4 && e4.message ? e4.message : "unknown"), true);
      });

      return spotifyRuntime.player.connect().then(function (ok) {
        if (!ok) throw new Error("Spotify connect failed");
        return spotifyRuntime.player;
      });
    });
  }

  function enableSpotifyOnSide(side) {
    var targetIdx = sideToIdx(side);
    var otherSide = side === "left" ? "right" : "left";
    var otherIdx = sideToIdx(otherSide);
    setSpotifyBtnState("left", false, true);
    setSpotifyBtnState("right", false, true);
    return initSpotifyPlayer()
      .then(function () {
        if (isPortalChannel(otherIdx)) {
          setSideSource(otherSide, { sourceKind: "local" });
        }
        spotifyRuntime.activeSide = side;
        setSideSource(side, buildSpotifyPortalDescriptor());
        applySpotifyStateToActiveSide();
        refreshSpotifyButtons();
        setStatus("Spotify enabled on " + side + " channel. Transferring playback...", false);
        return transferPlaybackToCurrentDevice(false);
      })
      .then(function () {
        var u = targetIdx === 0 ? ui.left : ui.right;
        var v = u && u.vol ? parseFloat(u.vol.value) : 1;
        return setSpotifyVolumeFromChannel(targetIdx, Number.isFinite(v) ? v : 1);
      })
      .then(function () {
        openSpotifySheet(side);
      })
      .catch(function (err) {
        setStatus("Could not enable Spotify: " + (err && err.message ? err.message : "unknown"), true);
        refreshSpotifyButtons();
      });
  }

  function disableSpotifyOnSide(side) {
    var idx = sideToIdx(side);
    if (!isPortalChannel(idx)) return;
    if (spotifyRuntime.activeSide === side) spotifyRuntime.activeSide = null;
    setSideSource(side, { sourceKind: "local" });
    stopSpotifyTicker();
    if (spotifyRuntime.player) {
      spotifyRuntime.player.pause().catch(function () {});
    }
    refreshSpotifyButtons();
    setStatus("Spotify disabled on " + side + " channel.", false);
  }

  function toggleSpotifyForSide(side) {
    var idx = sideToIdx(side);
    if (isPortalChannel(idx)) {
      disableSpotifyOnSide(side);
      return;
    }
    enableSpotifyOnSide(side);
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.hidden = !msg;
    statusEl.classList.toggle("beta-status--error", !!isError);
  }

  function refreshVolumeInteractivity() {
    ["left", "right"].forEach(function (side) {
      var idx = sideToIdx(side);
      var u = ui[side];
      if (!u || !u.vol) return;
      var locked = isIOSSpotifyVolumeLocked(idx);
      u.vol.disabled = !!locked;
      if (locked) {
        u.vol.setAttribute(
          "aria-label",
          (side === "left" ? "Left" : "Right") + " volume controlled by iOS hardware buttons while Spotify is active",
        );
        u.vol.title = "On iOS, Spotify volume is controlled by hardware buttons.";
      } else {
        u.vol.setAttribute("aria-label", (side === "left" ? "Left" : "Right") + " volume");
        u.vol.removeAttribute("title");
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
      } else if (!localSpeedStepEnabled) {
        rate = 1;
      } else {
        rate = speedPresets[speedIdx[idx]] || 1;
      }
      if (u.speedLabel) u.speedLabel.textContent = formatSpeedLabel(rate);
      if (u.speed) {
        var speedDisabled = isPortal || !localSpeedStepEnabled;
        u.speed.disabled = speedDisabled;
        if (isPortal) {
          u.speed.setAttribute("aria-label", (side === "left" ? "Left" : "Right") + " playback speed unavailable for Spotify");
        } else if (!localSpeedStepEnabled) {
          u.speed.setAttribute(
            "aria-label",
            (side === "left" ? "Left" : "Right") + " playback speed fixed at 1× (disabled in this beta)",
          );
        } else {
          u.speed.setAttribute("aria-label", (side === "left" ? "Left" : "Right") + " playback speed " + formatSpeedLabel(rate));
        }
      }
    });
  }

  function applyChannelVolumeToGraph(idx) {
    var u = idx === 0 ? ui.left : ui.right;
    if (!u || !u.vol) return;
    var g = trackGains[idx];
    if (!g) return;
    var v = parseFloat(u.vol.value);
    g.gain.value = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  }

  function setPlayIntent(chIdx, shouldPlay) {
    channelShouldBePlaying[chIdx] = !!shouldPlay;
    channelPlayIntentToken[chIdx] += 1;
    return channelPlayIntentToken[chIdx];
  }

  function currentPlayIntentToken(chIdx) {
    return channelPlayIntentToken[chIdx];
  }

  function applyLocalRateToAudio(audioEl, rate) {
    var safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
    audioEl.playbackRate = safeRate;
    // Safari can glitch with pitch correction at >=1.5x.
    try {
      if ("preservesPitch" in audioEl) audioEl.preservesPitch = false;
      if ("webkitPreservesPitch" in audioEl) audioEl.webkitPreservesPitch = false;
      if ("mozPreservesPitch" in audioEl) audioEl.mozPreservesPitch = false;
    } catch (e) {}
  }

  function syncLocalPlaybackRate(idx) {
    if (isPortalChannel(idx)) return;
    var rate = localSpeedStepEnabled ? speedPresets[speedIdx[idx]] || 1 : 1;
    applyLocalRateToAudio(audios[idx], rate);
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
    audios[chIdx].pause();
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
    refreshQueuePanelIfOpen();
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
    refreshQueuePanelIfOpen();
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

    var portal = isPortalChannel(chIdx);

    for (var i = 0; i < q.length; i++) {
      (function (rowIndex) {
        var file = q[rowIndex];
        var row = document.createElement("div");
        row.className = "beta-queue-row" + (rowIndex === cur ? " beta-queue-row--current" : "");
        row.setAttribute("role", "listitem");
        row.dataset.queueIndex = String(rowIndex);

        if (!portal) {
          var handle = document.createElement("span");
          handle.className = "beta-queue-row-handle";
          handle.setAttribute("draggable", "true");
          handle.setAttribute("aria-label", "Drag to reorder");
          handle.setAttribute("title", "Drag to reorder");
          handle.addEventListener("dragstart", function (e) {
            e.dataTransfer.setData("application/x-dicotic-queue-from", String(rowIndex));
            e.dataTransfer.effectAllowed = "move";
            row.classList.add("beta-queue-row--dragging");
          });
          handle.addEventListener("dragend", function () {
            row.classList.remove("beta-queue-row--dragging");
          });
          row.appendChild(handle);

          row.addEventListener("dragover", function (e) {
            e.preventDefault();
            try {
              e.dataTransfer.dropEffect = "move";
            } catch (err) {}
          });
          row.addEventListener("drop", function (e) {
            e.preventDefault();
            var from = parseInt(e.dataTransfer.getData("application/x-dicotic-queue-from"), 10);
            var to = rowIndex;
            if (!Number.isFinite(from) || from === to) return;
            reorderQueueItem(chIdx, from, to);
          });
        }

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

        row.appendChild(idxEl);
        row.appendChild(titleBtn);
        row.appendChild(del);
        queueListEl.appendChild(row);
      })(i);
    }
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

    ctx = new AC();
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
      ? '<rect x="146" y="120" width="84" height="272" rx="22" ry="22" fill="currentColor"/><rect x="282" y="120" width="84" height="272" rx="22" ry="22" fill="currentColor"/>'
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
    if (opts.includeQueue) refreshQueuePanelIfOpen();
  }

  function refreshAllUi() {
    renderTitles();
    renderSpeedLabels();
    refreshVolumeInteractivity();
    updatePlayLabels();
    updateSeekUi();
    refreshQueuePanelIfOpen();
  }

  function applyPausedTransport(chIdx) {
    setPlayIntent(chIdx, false);
    audios[chIdx].pause();
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
        openQueuePanel(side);
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

  function bindSpotify(side, idx, u) {
    if (!u.spotify) return;
    u.spotify.addEventListener("click", function () {
      var controller = getChannelController(idx);
      if (controller.isPortal) {
        ensureSpotifyToken()
          .then(function () {
            openSpotifySheet(side);
          })
          .catch(function (err) {
            if (isAuthMissingError(err) || (err && err.message === "spotify_scope_or_auth")) return spotifyAuthStart(side);
            setStatus("Could not open Spotify controls: " + (err && err.message ? err.message : "unknown"), true);
          });
        return;
      }
      ensureSpotifyToken()
        .then(function () {
          return enableSpotifyOnSide(side);
        })
        .then(function () {
          openSpotifySheet(side);
        })
        .catch(function (err) {
          if (isAuthMissingError(err)) return spotifyAuthStart(side);
          setStatus("Could not start Spotify: " + (err && err.message ? err.message : "unknown"), true);
        });
    });
  }

  function bindSpeedControl(idx, u) {
    if (!u.speed || !localSpeedStepEnabled) return;
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
    bindSpotify(side, idx, u);
    bindSpeedControl(idx, u);
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
    if (queueRoot && !queueRoot.hidden && queueRoot.contains(/** @type {Node} */ (tg))) return;
    if (spotifyRoot && !spotifyRoot.hidden && spotifyRoot.contains(/** @type {Node} */ (tg))) return;
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
    if (spotifyRoot && !spotifyRoot.hidden) closeSpotifySheet();
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
      case Engine.INTENT.SHUFFLE_TOGGLE:
        if (queuePanelChannel) toggleShuffleForChannel(sideToIdx(queuePanelChannel));
        break;
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

  if (queueShuffleBtn) {
    queueShuffleBtn.addEventListener("click", function () {
      dispatchPortalIntent({ type: Engine.INTENT.SHUFFLE_TOGGLE });
    });
  }
  if (spotifyBackdrop) {
    spotifyBackdrop.addEventListener("click", function () {
      closeSpotifySheet();
    });
  }
  if (spotifyCloseBtn) {
    spotifyCloseBtn.addEventListener("click", function () {
      closeSpotifySheet();
    });
  }
  if (spotifyTransferBtn) {
    spotifyTransferBtn.addEventListener("click", function () {
      setSpotifyModalLoading(true);
      transferPlaybackToCurrentDevice(false).finally(function () {
        setSpotifyModalLoading(false);
      });
    });
  }
  if (spotifyDisableBtn) {
    spotifyDisableBtn.addEventListener("click", function () {
      var side = spotifyRuntime.modalSide;
      if (!side) return;
      disableSpotifyOnSide(side);
      closeSpotifySheet();
    });
  }
  window.addEventListener("resize", function () {
    if (!queueRoot || queueRoot.hidden) return;
    setQueueLayoutClass();
  });

  /** @param {0|1} chIdx */
  function readChannelSwapSlice(chIdx) {
    var u = chIdx === 0 ? ui.left : ui.right;
    return {
      queueFiles: channelQueueFiles[chIdx],
      currentIndex: channelCurrentIndex[chIdx],
      shuffleEnabled: channelShuffleEnabled[chIdx],
      lastBlobUrl: channelLastBlobUrl[chIdx],
      sourceKind: channelSourceKind[chIdx],
      portalState: clonePortalState(channelPortalState[chIdx]),
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
    if (!localSpeedStepEnabled) speedIdx[chIdx] = 1;
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
      var bindRate = localSpeedStepEnabled ? speedPresets[speedIdx[destIdx]] || 1 : 1;
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

  function normalizePortalDescriptor(descriptor) {
    var d = descriptor || {};
    return {
      sourceKind: d.sourceKind === "portal" ? "portal" : "local",
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

  function setSideSource(side, descriptor) {
    var chIdx = sideToIdx(side);
    var normalized = normalizePortalDescriptor(descriptor);
    channelSourceKind[chIdx] = normalized.sourceKind;
    channelLoadRequestId[chIdx] += 1;
    channelPlayIntentToken[chIdx] += 1;
    if (normalized.sourceKind === "portal") {
      channelPortalState[chIdx] = clonePortalState(normalized);
      channelShouldBePlaying[chIdx] = !!normalized.isPlaying;
      audios[chIdx].pause();
      audios[chIdx].removeAttribute("src");
      audios[chIdx].load();
    } else {
      channelPortalState[chIdx] = null;
      channelShouldBePlaying[chIdx] = false;
      if (localSpeedStepEnabled && Number.isFinite(normalized.playbackRate)) {
        applyLocalRateToAudio(audios[chIdx], normalized.playbackRate);
      } else {
        applyLocalRateToAudio(audios[chIdx], 1);
      }
      if (!audios[chIdx].src && getCurrentFile(chIdx)) {
        assignAudioFromCurrentIndex(chIdx, { doPlay: false });
      }
    }
    refreshAllUi();
    refreshSpotifyButtons();
  }

  function updatePortalSideState(side, patch) {
    var chIdx = sideToIdx(side);
    if (channelSourceKind[chIdx] !== "portal") return;
    var current = clonePortalState(channelPortalState[chIdx]) || normalizePortalDescriptor({ sourceKind: "portal" });
    var next = Object.assign({}, current, patch || {});
    channelPortalState[chIdx] = normalizePortalDescriptor(Object.assign({}, next, { sourceKind: "portal" }));
    refreshChannelUi(chIdx, { includeSpeed: true, includeSeek: true });
  }

  initSpotifyAuthFromUrl()
    .then(function () {})
    .catch(function () {});

  requestAnimationFrame(loopSeek);
  refreshChannelUi(0, { includeSpeed: true });
  refreshVolumeInteractivity();
  refreshSpotifyButtons();
})();
