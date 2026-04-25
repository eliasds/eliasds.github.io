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
  /** Long-press on prev/next: seek this many seconds each tick. */
  var SKIP_BURST_STEP_SEC = 5;
  var SKIP_BURST_INTERVAL_MS = 200;
  /** Hold this long before burst-seek starts (tap before this = change track). */
  var LONG_PRESS_START_MS = 400;
  var SPOTIFY_REDIRECT_URI = "https://dicotic.com/try/";
  var SPOTIFY_SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
  ].join(" ");

  /** @typedef {'left'|'right'} ChannelSide */
  /** @typedef {'off'|'queue'|'one'} RepeatMode */
  /** @typedef {'local'|'portal'} SourceKind */

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
  /** @type {SourceKind[]} */
  var channelSourceKind = ["local", "local"];
  /** @type {Array<{ title: string, artist: string, isPlaying: boolean, currentTime: number, duration: number, playbackRate: number, canSeek: boolean, onPlayPause: ((nextPlaying: boolean) => void) | null, onSeek: ((seconds: number) => void) | null, onNext: (() => void) | null, onPrev: (() => void) | null, onSetSpeed: ((rate: number) => void) | null, onSwapToSide: ((side: ChannelSide) => void) | null } | null>} */
  var channelPortalState = [null, null];

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
    ticker: null,
    tokenValue: "",
    tokenExpiresAt: 0,
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

  function isPortalChannel(chIdx) {
    return channelSourceKind[chIdx] === "portal";
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
          return enableSpotifyOnSide(side).catch(function () {
            setStatus("Spotify signed in. Tap Spotify again to enable playback.", false);
          });
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

  function startSpotifyTicker() {
    stopSpotifyTicker();
    spotifyRuntime.ticker = setInterval(function () {
      if (!spotifyRuntime.lastState || !spotifyRuntime.activeSide) return;
      var side = spotifyRuntime.activeSide;
      var idx = sideToIdx(side);
      if (!isPortalChannel(idx)) return;
      var patch = readTrackFromState(spotifyRuntime.lastState);
      if (patch.isPlaying) {
        patch.currentTime += 0.5;
        var duration = Number.isFinite(patch.duration) ? patch.duration : 0;
        if (duration > 0 && patch.currentTime > duration) patch.currentTime = duration;
      }
      updatePortalSideState(side, patch);
    }, 500);
  }

  function applySpotifyStateToActiveSide() {
    if (!spotifyRuntime.activeSide || !spotifyRuntime.lastState) return;
    var side = spotifyRuntime.activeSide;
    var idx = sideToIdx(side);
    if (!isPortalChannel(idx)) return;
    var patch = readTrackFromState(spotifyRuntime.lastState);
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
        setStatus("Spotify enabled on " + side + " channel.", false);
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

  function debugLog(runId, hypothesisId, location, message, data) {
    fetch("http://127.0.0.1:7661/ingest/9aa15d7f-1109-489b-b396-9358a082e65d", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "39d22a" },
      body: JSON.stringify({
        sessionId: "39d22a",
        runId: runId,
        hypothesisId: hypothesisId,
        location: location,
        message: message,
        data: data,
        timestamp: Date.now(),
      }),
    }).catch(function () {});
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
      var portalState = channelPortalState[idx];
      var rate =
        isPortalChannel(idx) && portalState
          ? Number.isFinite(portalState.playbackRate) && portalState.playbackRate > 0
            ? portalState.playbackRate
            : 1
          : speedPresets[speedIdx[idx]] || 1;
      if (u.speedLabel) u.speedLabel.textContent = formatSpeedLabel(rate);
      if (u.speed) {
        u.speed.setAttribute("aria-label", (side === "left" ? "Left" : "Right") + " playback speed " + formatSpeedLabel(rate));
      }
    });
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
        if (typeof seekTo === "number" && Number.isFinite(seekTo) && seekTo >= 0) {
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

  /**
   * Manual next track: repeat-one does not block advancing (unlike onTrackEndedForChannel).
   */
  function skipToNextTrack(chIdx) {
    var q = getQueue(chIdx);
    if (q.length === 0) return;
    var playing = !audios[chIdx].paused;
    var index = channelCurrentIndex[chIdx];
    var repeatMode = channelRepeatMode[chIdx];

    if (index < q.length - 1) {
      channelCurrentIndex[chIdx] = index + 1;
      assignAudioFromCurrentIndex(chIdx, { doPlay: playing }).then(function () {
        updatePlayLabels();
        refreshQueuePanelIfOpen();
      });
      return;
    }
    if (repeatMode === "queue" && q.length > 0) {
      channelCurrentIndex[chIdx] = 0;
      assignAudioFromCurrentIndex(chIdx, { doPlay: playing }).then(function () {
        updatePlayLabels();
        refreshQueuePanelIfOpen();
      });
      return;
    }
    audios[chIdx].pause();
    updatePlayLabels();
    refreshQueuePanelIfOpen();
  }

  /**
   * Manual previous track: repeat-one does not block (same as skipToNextTrack).
   */
  function skipToPreviousTrack(chIdx) {
    var q = getQueue(chIdx);
    if (q.length === 0) return;
    var playing = !audios[chIdx].paused;
    var index = channelCurrentIndex[chIdx];
    var repeatMode = channelRepeatMode[chIdx];

    if (index > 0) {
      channelCurrentIndex[chIdx] = index - 1;
      assignAudioFromCurrentIndex(chIdx, { doPlay: playing }).then(function () {
        updatePlayLabels();
        refreshQueuePanelIfOpen();
      });
      return;
    }
    if (repeatMode === "queue" && q.length > 0) {
      channelCurrentIndex[chIdx] = q.length - 1;
      assignAudioFromCurrentIndex(chIdx, { doPlay: playing }).then(function () {
        updatePlayLabels();
        refreshQueuePanelIfOpen();
      });
      return;
    }
    assignAudioFromCurrentIndex(chIdx, { doPlay: playing, seekTo: 0 }).then(function () {
      updatePlayLabels();
      refreshQueuePanelIfOpen();
    });
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
      var bothPlaying = leftPlaying && rightPlaying;
      dualPlayBtn.innerHTML =
        '<svg class="ionicon beta-dual-play-glyph" width="88" height="88" viewBox="0 0 512 512" aria-hidden="true">' +
        channelPlayIcon(bothPlaying) +
        "</svg>";
      dualPlayBtn.setAttribute("aria-label", bothPlaying ? "Pause both channels" : "Play both channels");
    }
  }

  function seekBurstRelative(chIdx, deltaSec) {
    var a = audios[chIdx];
    var nextT = a.currentTime + deltaSec;
    if (deltaSec < 0) {
      a.currentTime = Math.max(0, nextT);
    } else {
      var d = a.duration;
      var maxT = Number.isFinite(d) && d > 0 ? d : nextT;
      a.currentTime = Math.min(maxT, nextT);
    }
  }

  function wirePrevNextTapOrBurst(chIdx, prevEl, nextEl) {
    function bindSkipBtn(btn, direction) {
      var longTimer = null;
      var burstInt = null;
      var didLongPress = false;
      var capturedId = null;

      function clearTimers() {
        if (longTimer !== null) {
          clearTimeout(longTimer);
          longTimer = null;
        }
        if (burstInt !== null) {
          clearInterval(burstInt);
          burstInt = null;
        }
      }

      function startBurst() {
        longTimer = null;
        didLongPress = true;
        seekBurstRelative(chIdx, direction * SKIP_BURST_STEP_SEC);
        burstInt = setInterval(function () {
          seekBurstRelative(chIdx, direction * SKIP_BURST_STEP_SEC);
        }, SKIP_BURST_INTERVAL_MS);
      }

      btn.addEventListener("pointerdown", function (e) {
        if (!e.isPrimary) return;
        e.preventDefault();
        didLongPress = false;
        clearTimers();
        try {
          btn.setPointerCapture(e.pointerId);
          capturedId = e.pointerId;
        } catch (err) {}
        longTimer = setTimeout(startBurst, LONG_PRESS_START_MS);
      });

      btn.addEventListener("click", function (e) {
        if (e.detail !== 0) return;
        if (isPortalChannel(chIdx)) {
          var pState = channelPortalState[chIdx];
          safeCall(direction < 0 ? pState && pState.onPrev : pState && pState.onNext);
          return;
        }
        if (direction < 0) skipToPreviousTrack(chIdx);
        else skipToNextTrack(chIdx);
      });

      btn.addEventListener("pointerup", function (e) {
        if (!e.isPrimary) return;
        if (capturedId !== null) {
          try {
            if (btn.hasPointerCapture(capturedId)) btn.releasePointerCapture(capturedId);
          } catch (err2) {}
          capturedId = null;
        }
        var wasLongPress = didLongPress;
        clearTimers();
        if (!wasLongPress) {
          if (isPortalChannel(chIdx)) {
            var pState2 = channelPortalState[chIdx];
            safeCall(direction < 0 ? pState2 && pState2.onPrev : pState2 && pState2.onNext);
            return;
          }
          if (direction < 0) skipToPreviousTrack(chIdx);
          else skipToNextTrack(chIdx);
        }
      });

      btn.addEventListener("pointercancel", function () {
        if (capturedId !== null) {
          try {
            if (btn.hasPointerCapture(capturedId)) btn.releasePointerCapture(capturedId);
          } catch (err3) {}
          capturedId = null;
        }
        clearTimers();
      });
    }

    if (prevEl) bindSkipBtn(prevEl, -1);
    if (nextEl) bindSkipBtn(nextEl, 1);
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
        if (isPortalChannel(idx)) {
          var pState = channelPortalState[idx];
          if (pState && pState.onPlayPause) {
            safeCall(pState.onPlayPause, [!pState.isPlaying]);
          }
          return;
        }
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
        if (isPortalChannel(idx)) {
          var pState = channelPortalState[idx];
          if (!pState || !pState.onSeek) return;
          var vPortal = parseFloat(u.seek.value);
          if (Number.isFinite(vPortal)) safeCall(pState.onSeek, [vPortal]);
          return;
        }
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

    wirePrevNextTapOrBurst(idx, u.prev, u.next);

    if (u.queue) {
      u.queue.addEventListener("click", function () {
        openQueuePanel(side);
      });
    }

    if (u.spotify) {
      u.spotify.addEventListener("click", function () {
        var activeIdx = sideToIdx(side);
        if (isPortalChannel(activeIdx)) {
          disableSpotifyOnSide(side);
          return;
        }
        ensureSpotifyToken()
          .then(function () {
            return enableSpotifyOnSide(side);
          })
          .catch(function (err) {
            if (isAuthMissingError(err)) {
              return spotifyAuthStart(side);
            }
            setStatus("Could not start Spotify: " + (err && err.message ? err.message : "unknown"), true);
          });
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
        if (isPortalChannel(idx)) {
          var pState = channelPortalState[idx];
          if (pState && pState.onSetSpeed) safeCall(pState.onSetSpeed, [rate]);
        }
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
      var leftPortal = isPortalChannel(0) ? channelPortalState[0] : null;
      var rightPortal = isPortalChannel(1) ? channelPortalState[1] : null;
      var leftPlaying = leftPortal ? !!leftPortal.isPlaying : !audioLeft.paused;
      var rightPlaying = rightPortal ? !!rightPortal.isPlaying : !audioRight.paused;
      var bothPlaying = leftPlaying && rightPlaying;
      if (bothPlaying) {
        if (leftPortal && leftPortal.onPlayPause) safeCall(leftPortal.onPlayPause, [false]);
        else audioLeft.pause();
        if (rightPortal && rightPortal.onPlayPause) safeCall(rightPortal.onPlayPause, [false]);
        else audioRight.pause();
        updatePlayLabels();
        return;
      }

      ensureGraph()
        .then(function () {
          var tasks = [];
          if (leftPortal && leftPortal.onPlayPause) safeCall(leftPortal.onPlayPause, [true]);
          else tasks.push(audioLeft.play());
          if (rightPortal && rightPortal.onPlayPause) safeCall(rightPortal.onPlayPause, [true]);
          else tasks.push(audioRight.play());
          if (tasks.length === 0) return;
          return Promise.all(tasks).catch(function () {
            setStatus("Playback blocked or no audio loaded.", true);
          });
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
    var rateL = al.playbackRate;
    var rateR = ar.playbackRate;
    var kindL = channelSourceKind[0];
    var kindR = channelSourceKind[1];
    var portalL = clonePortalState(channelPortalState[0]);
    var portalR = clonePortalState(channelPortalState[1]);

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

    // #region agent log
    debugLog("pre-fix", "H1_H3", "src/tryPortal.js:swapQueues:start", "Swap start snapshot", {
      srcL: srcL || "",
      srcR: srcR || "",
      pausedL: pausedL,
      pausedR: pausedR,
      currentTimeL: tL,
      currentTimeR: tR,
      queueLenL: qL.length,
      queueLenR: qR.length,
      idxL: iL,
      idxR: iR,
      sourceKindL: kindL,
      sourceKindR: kindR,
    });
    // #endregion

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
    channelSourceKind[0] = kindR;
    channelSourceKind[1] = kindL;
    channelPortalState[0] = portalR;
    channelPortalState[1] = portalL;
    trackMeta[0] = metaR;
    trackMeta[1] = metaL;

    al.pause();
    ar.pause();
    function bindSideAudioFromSnapshot(destIdx) {
      var movedFrom = destIdx === 0 ? 1 : 0;
      var destAudio = destIdx === 0 ? al : ar;
      var movedSrc = movedFrom === 0 ? srcL : srcR;
      var movedTime = movedFrom === 0 ? tL : tR;
      var movedPaused = movedFrom === 0 ? pausedL : pausedR;
      var movedRate = movedFrom === 0 ? rateL : rateR;
      var movedKind = movedFrom === 0 ? kindL : kindR;
      if (channelSourceKind[destIdx] !== "local") {
        destAudio.removeAttribute("src");
        destAudio.load();
        destAudio.playbackRate = 1;
        return;
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
      destAudio.playbackRate = Number.isFinite(movedRate) ? movedRate : 1;
      return {
        shouldResume: !movedPaused,
        seekTo: movedTime,
      };
    }

    function finish() {
      // #region agent log
      debugLog("pre-fix", "H2_H5", "src/tryPortal.js:swapQueues:finish", "Finish called after swap", {
        alSrc: al.src || "",
        arSrc: ar.src || "",
        pendingAtFinish: pending,
        pausedLBeforeSwap: pausedL,
        pausedRBeforeSwap: pausedR,
        sourceKindLeftAfterSwap: channelSourceKind[0],
        sourceKindRightAfterSwap: channelSourceKind[1],
      });
      // #endregion
      var leftBinding = bindSideAudioFromSnapshot(0);
      var rightBinding = bindSideAudioFromSnapshot(1);

      if (leftBinding && leftBinding.shouldRebindFromQueue) {
        assignAudioFromCurrentIndex(0, { doPlay: false });
      }
      if (rightBinding && rightBinding.shouldRebindFromQueue) {
        assignAudioFromCurrentIndex(1, { doPlay: false });
      }

      if (leftBinding && Number.isFinite(leftBinding.seekTo) && al.src) {
        try {
          al.currentTime = leftBinding.seekTo;
        } catch (e) {}
      }
      if (rightBinding && Number.isFinite(rightBinding.seekTo) && ar.src) {
        try {
          ar.currentTime = rightBinding.seekTo;
        } catch (e) {}
      }

      renderTitles();
      renderSpeedLabels();
      updatePlayLabels();
      updateSeekUi();

      var notifyLeftPortal = channelSourceKind[0] === "portal" ? channelPortalState[0] : null;
      var notifyRightPortal = channelSourceKind[1] === "portal" ? channelPortalState[1] : null;
      if (notifyLeftPortal && notifyLeftPortal.onSwapToSide) safeCall(notifyLeftPortal.onSwapToSide, [idxToSide(0)]);
      if (notifyRightPortal && notifyRightPortal.onSwapToSide) safeCall(notifyRightPortal.onSwapToSide, [idxToSide(1)]);

      if (leftBinding && leftBinding.shouldResume && al.src) {
        al.play().catch(function (err) {
          // #region agent log
          debugLog("pre-fix", "H5", "src/tryPortal.js:swapQueues:playLeftAfterSwap", "Left play after swap rejected", {
            reason: err && err.message ? err.message : "unknown",
          });
          // #endregion
        });
      }
      if (rightBinding && rightBinding.shouldResume && ar.src) {
        ar.play().catch(function (err2) {
          // #region agent log
          debugLog("pre-fix", "H5", "src/tryPortal.js:swapQueues:playRightAfterSwap", "Right play after swap rejected", {
            reason: err2 && err2.message ? err2.message : "unknown",
          });
          // #endregion
        });
      }
      refreshQueuePanelIfOpen();
    }

    var pending = 0;
    function onReady() {
      pending--;
      // #region agent log
      debugLog("pre-fix", "H2", "src/tryPortal.js:swapQueues:onReady", "loadeddata received for swapped source", {
        pendingAfterDecrement: pending,
      });
      // #endregion
      if (pending <= 0) finish();
    }
    if (channelSourceKind[0] === "local" && srcR) {
      pending++;
      al.addEventListener("loadeddata", onReady, { once: true });
    }
    if (channelSourceKind[1] === "local" && srcL) {
      pending++;
      ar.addEventListener("loadeddata", onReady, { once: true });
    }
    if (pending === 0) finish();
  }

  if (swapBtn) {
    swapBtn.addEventListener("click", function () {
      // #region agent log
      debugLog("pre-fix", "H4", "src/tryPortal.js:swapBtn:click", "Swap button clicked before ensureGraph", {
        ctxExists: !!ctx,
      });
      // #endregion
      ensureGraph()
        .then(function () {
          swapQueues();
        })
        .catch(function (err) {
          // #region agent log
          debugLog("pre-fix", "H4", "src/tryPortal.js:swapBtn:ensureGraphCatch", "ensureGraph rejected before swap", {
            reason: err && err.message ? err.message : "unknown",
          });
          // #endregion
        });
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
    if (normalized.sourceKind === "portal") {
      channelPortalState[chIdx] = clonePortalState(normalized);
      audios[chIdx].pause();
      audios[chIdx].removeAttribute("src");
      audios[chIdx].load();
    } else {
      channelPortalState[chIdx] = null;
      if (Number.isFinite(normalized.playbackRate)) {
        audios[chIdx].playbackRate = normalized.playbackRate;
      }
      if (!audios[chIdx].src && getCurrentFile(chIdx)) {
        assignAudioFromCurrentIndex(chIdx, { doPlay: false });
      }
    }
    renderTitles();
    renderSpeedLabels();
    updatePlayLabels();
    updateSeekUi();
    refreshQueuePanelIfOpen();
    refreshSpotifyButtons();
  }

  function updatePortalSideState(side, patch) {
    var chIdx = sideToIdx(side);
    if (channelSourceKind[chIdx] !== "portal") return;
    var current = clonePortalState(channelPortalState[chIdx]) || normalizePortalDescriptor({ sourceKind: "portal" });
    var next = Object.assign({}, current, patch || {});
    channelPortalState[chIdx] = normalizePortalDescriptor(Object.assign({}, next, { sourceKind: "portal" }));
    renderTitles();
    renderSpeedLabels();
    updatePlayLabels();
    updateSeekUi();
  }

  initSpotifyAuthFromUrl()
    .then(function () {})
    .catch(function () {});

  requestAnimationFrame(loopSeek);
  renderTitles();
  renderSpeedLabels();
  setBoostUi(0);
  setBoostUi(1);
  updatePlayLabels();
  refreshSpotifyButtons();

  window.dicoticBeta = {
    ensureGraph: ensureGraph,
    ensureSpotifyPlayer: initSpotifyPlayer,
    getSpotifyDeviceId: function () {
      return spotifyRuntime.deviceId || "";
    },
    swapQueues: swapQueues,
    openQueue: openQueuePanel,
    closeQueue: closeQueuePanel,
    setSideSource: setSideSource,
    updatePortalSideState: updatePortalSideState,
  };
})();
