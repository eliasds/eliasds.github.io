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
  const queueLoadMoreBtn = document.getElementById("beta-queue-load-more");
  const queueViewToggle = document.getElementById("beta-queue-view-toggle");
  const queueViewQueueBtn = document.getElementById("beta-queue-view-queue");
  const queueViewLibraryBtn = document.getElementById("beta-queue-view-library");
  const queueEmptyEl = document.getElementById("beta-queue-empty");

  if (!audioLeft || !audioRight) return;

  /** Sticky midpoint — PanSlider.tsx CENTER_SNAP_THRESHOLD */
  var CENTER_SNAP = 0.08;
  /** Long-press on prev/next: seek this many seconds each tick. */
  var SKIP_BURST_STEP_SEC = 5;
  var SKIP_BURST_INTERVAL_MS = 200;
  /** Hold this long before burst-seek starts (tap before this = change track). */
  var LONG_PRESS_START_MS = 400;
  var PREVIOUS_RESTART_THRESHOLD_SEC = 3;
  var SPOTIFY_REDIRECT_URI = "https://dicotic.com/try/";
  var SPOTIFY_API_BASE = "https://api.spotify.com/v1";
  var SPOTIFY_SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-library-read",
  ].join(" ");

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
  var queuePanelView = /** @type {"queue"|"library"} */ ("queue");
  var channelMode = /** @type {("local"|"spotify")[]} */ (["local", "local"]);
  var localPanBeforeSpotify = [-1, 1];
  var spotifyChannelIdx = /** @type {number | null} */ (null);
  var spotifyQueueItems = [];
  var spotifyQueueNowPlaying = null;
  var spotifyLibraryItems = [];
  var spotifyLibraryOffset = 0;
  var spotifyLibraryHasMore = false;
  var spotifyLibraryLoading = false;
  var spotifyLibraryError = "";
  var spotifyState = null;
  var spotifyDeviceId = "";
  var spotifySdkReady = false;
  var spotifyPlayer = null;
  var spotifyConnectPromise = null;
  var spotifyPlaybackPollTimer = null;
  var spotifyAuth = {
    accessToken: "",
    refreshToken: "",
    expiresAt: 0,
  };

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
      balanceBlock: document.querySelector(".beta-segment--left .beta-balance-block"),
      segment: document.querySelector(".beta-segment--left"),
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
      balanceBlock: document.querySelector(".beta-segment--right .beta-balance-block"),
      segment: document.querySelector(".beta-segment--right"),
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

  function clearSpotifyAuth() {
    spotifyAuth.accessToken = "";
    spotifyAuth.refreshToken = "";
    spotifyAuth.expiresAt = 0;
    try {
      sessionStorage.removeItem(spotifyStorageKey("auth"));
    } catch (e) {}
  }

  function saveSpotifyPendingChannel(chIdx) {
    try {
      sessionStorage.setItem(spotifyStorageKey("pending_channel"), String(chIdx));
    } catch (e) {}
  }

  function consumeSpotifyPendingChannel() {
    try {
      var raw = sessionStorage.getItem(spotifyStorageKey("pending_channel"));
      sessionStorage.removeItem(spotifyStorageKey("pending_channel"));
      if (raw === "0" || raw === "1") return parseInt(raw, 10);
    } catch (e) {}
    return null;
  }

  function clearSpotifyOauthTransient() {
    try {
      sessionStorage.removeItem(spotifyStorageKey("pkce_verifier"));
      sessionStorage.removeItem(spotifyStorageKey("oauth_state"));
    } catch (e) {}
  }

  function getRuntimeRedirectUri() {
    if (typeof window === "undefined") return SPOTIFY_REDIRECT_URI;
    var p = window.location.protocol + "//" + window.location.host + window.location.pathname;
    if (p.indexOf("/try/") >= 0) return p;
    return SPOTIFY_REDIRECT_URI;
  }

  function spotifyAuthStart(chIdx) {
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
      if (chIdx === 0 || chIdx === 1) saveSpotifyPendingChannel(chIdx);
      setStatus("Continue in Spotify to authorize dicotic.", false);
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
  }

  function ensureSpotifyToken() {
    if (spotifyAuth.accessToken && Date.now() < spotifyAuth.expiresAt) {
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
          throw new Error("spotify auth expired");
        });
    }
    return Promise.reject(new Error("no spotify auth"));
  }

  function spotifyApi(path, opts) {
    opts = opts || {};
    return ensureSpotifyToken().then(function (token) {
      var headers = Object.assign({}, opts.headers || {}, {
        Authorization: "Bearer " + token,
      });
      return fetch(SPOTIFY_API_BASE + path, Object.assign({}, opts, { headers: headers })).then(function (r) {
        if (r.status === 204) return null;
        if (!r.ok) throw new Error("spotify api failed: " + r.status);
        return r.json();
      });
    });
  }

  function spotifyTrackName(item) {
    if (!item) return "No track loaded";
    return item.name || "Spotify item";
  }

  function spotifyTrackArtist(item) {
    if (!item) return "";
    if (item.type === "episode") {
      if (item.show && item.show.name) return item.show.name;
      return "Podcast";
    }
    if (!item.artists || !item.artists.length) return "";
    return item.artists.map(function (a) { return a.name; }).join(", ");
  }

  function updateSpotifyTrackMetaFromState(state) {
    if (!state || spotifyChannelIdx === null) return;
    var item = state.track_window && state.track_window.current_track ? state.track_window.current_track : null;
    trackMeta[spotifyChannelIdx] = {
      title: spotifyTrackName(item),
      artist: spotifyTrackArtist(item),
    };
    renderTitles();
  }

  function loadSpotifySdk() {
    if (spotifySdkReady && window.Spotify && window.Spotify.Player) return Promise.resolve();
    if (spotifyConnectPromise) return spotifyConnectPromise;
    spotifyConnectPromise = new Promise(function (resolve, reject) {
      if (window.Spotify && window.Spotify.Player) {
        spotifySdkReady = true;
        resolve();
        return;
      }
      window.onSpotifyWebPlaybackSDKReady = function () {
        spotifySdkReady = true;
        resolve();
      };
      var script = document.createElement("script");
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      script.onerror = function () {
        reject(new Error("spotify sdk failed"));
      };
      document.head.appendChild(script);
    });
    return spotifyConnectPromise;
  }

  function transferSpotifyPlayback(deviceId, play) {
    return spotifyApi("/me/player", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_ids: [deviceId], play: !!play }),
    });
  }

  function ensureSpotifyPlayer() {
    if (spotifyPlayer) return Promise.resolve(spotifyPlayer);
    return loadSpotifySdk()
      .then(ensureSpotifyToken)
      .then(function () {
        spotifyPlayer = new Spotify.Player({
          name: "dicotic web player",
          getOAuthToken: function (cb) {
            ensureSpotifyToken()
              .then(function (t) { cb(t); })
              .catch(function () { cb(""); });
          },
          volume: 0.8,
        });
        spotifyPlayer.addListener("ready", function (evt) {
          spotifyDeviceId = evt && evt.device_id ? evt.device_id : "";
        });
        spotifyPlayer.addListener("authentication_error", function () {
          clearSpotifyAuth();
          setStatus("Spotify auth expired. Tap Spotify again to reconnect.", true);
        });
        spotifyPlayer.addListener("account_error", function () {
          setStatus("Spotify Premium is required for web playback.", true);
        });
        spotifyPlayer.addListener("playback_error", function (evt) {
          var msg = evt && evt.message ? evt.message : "Spotify playback failed.";
          setStatus(msg, true);
        });
        spotifyPlayer.addListener("player_state_changed", function (state) {
          spotifyState = state || null;
          updateSpotifyTrackMetaFromState(state);
          updatePlayLabels();
          refreshQueuePanelIfOpen();
        });
        return spotifyPlayer.connect().then(function (ok) {
          if (!ok) throw new Error("spotify connect failed");
          return spotifyPlayer;
        });
      });
  }

  function waitForSpotifyDevice(timeoutMs) {
    if (spotifyDeviceId) return Promise.resolve(spotifyDeviceId);
    var timeout = Math.max(500, timeoutMs || 5000);
    return new Promise(function (resolve, reject) {
      var startedAt = Date.now();
      var timer = setInterval(function () {
        if (spotifyDeviceId) {
          clearInterval(timer);
          resolve(spotifyDeviceId);
          return;
        }
        if (Date.now() - startedAt >= timeout) {
          clearInterval(timer);
          reject(new Error("spotify device unavailable"));
        }
      }, 120);
    });
  }

  function pollSpotifyPlaybackState() {
    if (spotifyPlaybackPollTimer) clearInterval(spotifyPlaybackPollTimer);
    spotifyPlaybackPollTimer = setInterval(function () {
      if (!spotifyPlayer) return;
      spotifyPlayer.getCurrentState().then(function (state) {
        if (state) {
          spotifyState = state;
          updateSpotifyTrackMetaFromState(state);
        }
      });
    }, 2500);
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

  function channelSideByIdx(idx) {
    return idx === 0 ? "left" : "right";
  }

  function setUnsupportedUiForChannel(chIdx, unsupported) {
    var side = channelSideByIdx(chIdx);
    var u = ui[side];
    if (!u) return;
    var msg = "Unsupported by Spotify";
    if (u.boost) {
      u.boost.classList.toggle("beta-unsupported", unsupported);
      u.boost.setAttribute("title", unsupported ? msg : "");
      u.boost.setAttribute("aria-disabled", unsupported ? "true" : "false");
    }
    if (u.speed) {
      u.speed.classList.toggle("beta-unsupported", unsupported);
      u.speed.setAttribute("title", unsupported ? msg : "");
      u.speed.setAttribute("aria-disabled", unsupported ? "true" : "false");
    }
    if (u.balanceBlock) {
      u.balanceBlock.classList.toggle("beta-unsupported", unsupported);
      u.balanceBlock.setAttribute("title", unsupported ? msg : "");
      if (unsupported && u.pan) setPanInputValue(u.pan, 0);
      else if (!unsupported && u.pan) setPanInputValue(u.pan, localPanBeforeSpotify[chIdx]);
    }
  }

  function setSpotifyButtonState(chIdx, active) {
    var side = channelSideByIdx(chIdx);
    var btn = ui[side] && ui[side].spotify;
    if (!btn) return;
    btn.classList.toggle("beta-small-btn--active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.setAttribute("aria-label", active ? "Disable Spotify on " + side + " channel" : "Enable Spotify on " + side + " channel");
  }

  function setSpotifyButtonsEnabled(enabled) {
    ["left", "right"].forEach(function (side) {
      var btn = ui[side] && ui[side].spotify;
      if (!btn) return;
      btn.disabled = !enabled;
      if (!enabled) {
        btn.setAttribute("title", "Spotify not configured");
      } else if (btn.getAttribute("title") === "Spotify not configured") {
        btn.removeAttribute("title");
      }
    });
  }

  function showSpotifyConfigHintIfNeeded() {
    var clientId = getSpotifyClientId();
    if (clientId) {
      setSpotifyButtonsEnabled(true);
      return true;
    }
    setSpotifyButtonsEnabled(false);
    setStatus(
      "Spotify is not configured on this build. Set window.__SPOTIFY_CLIENT_ID__ and ensure Redirect URI matches https://dicotic.com/try/.",
      true,
    );
    return false;
  }

  function refreshModeUi() {
    [0, 1].forEach(function (idx) {
      var isSpotify = channelMode[idx] === "spotify";
      setSpotifyButtonState(idx, isSpotify);
      setUnsupportedUiForChannel(idx, isSpotify);
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
    var elapsed = audios[chIdx].currentTime || 0;

    if (elapsed > PREVIOUS_RESTART_THRESHOLD_SEC) {
      assignAudioFromCurrentIndex(chIdx, { doPlay: playing, seekTo: 0 }).then(function () {
        updatePlayLabels();
        refreshQueuePanelIfOpen();
      });
      return;
    }

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
    var spotifyMode = channelMode[chIdx] === "spotify";
    if (spotifyMode) {
      queueShuffleBtn.setAttribute("aria-disabled", "true");
      queueRepeatBtn.setAttribute("aria-disabled", "true");
      queueShuffleBtn.classList.remove("beta-queue-icon--active");
      queueRepeatBtn.classList.remove("beta-queue-icon--active");
      queueShuffleBtn.setAttribute("title", "Unsupported by Spotify");
      queueRepeatBtn.setAttribute("title", "Unsupported by Spotify");
      return;
    }
    queueShuffleBtn.setAttribute("aria-disabled", "false");
    queueRepeatBtn.setAttribute("aria-disabled", "false");
    queueShuffleBtn.setAttribute("title", "Shuffle");
    queueRepeatBtn.setAttribute("title", "Repeat");
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

  function updateQueueViewControls(chIdx) {
    var spotifyMode = channelMode[chIdx] === "spotify";
    if (queueViewToggle) queueViewToggle.hidden = !spotifyMode;
    if (!spotifyMode) queuePanelView = "queue";
    if (queueViewQueueBtn) {
      var queueActive = queuePanelView === "queue";
      queueViewQueueBtn.classList.toggle("beta-queue-view-btn--active", queueActive);
      queueViewQueueBtn.setAttribute("aria-pressed", queueActive ? "true" : "false");
    }
    if (queueViewLibraryBtn) {
      var libraryActive = queuePanelView === "library";
      queueViewLibraryBtn.classList.toggle("beta-queue-view-btn--active", libraryActive);
      queueViewLibraryBtn.setAttribute("aria-pressed", libraryActive ? "true" : "false");
    }
    if (queueClearBtn) queueClearBtn.hidden = spotifyMode && queuePanelView === "library";
    if (queueLoadMoreBtn) queueLoadMoreBtn.hidden = !(spotifyMode && queuePanelView === "library" && spotifyLibraryHasMore);
  }

  function setQueuePanelView(view) {
    if (view !== "queue" && view !== "library") return;
    queuePanelView = view;
    refreshQueuePanelIfOpen();
  }

  function fetchSpotifyQueue() {
    return spotifyApi("/me/player/queue")
      .then(function (data) {
        spotifyQueueNowPlaying = data && data.currently_playing ? data.currently_playing : null;
        spotifyQueueItems = data && data.queue ? data.queue : [];
      })
      .catch(function () {
        spotifyQueueNowPlaying = null;
        spotifyQueueItems = [];
      });
  }

  function fetchSpotifyLibrary(opts) {
    opts = opts || {};
    var reset = !!opts.reset;
    if (spotifyLibraryLoading) return Promise.resolve();
    if (reset) {
      spotifyLibraryItems = [];
      spotifyLibraryOffset = 0;
      spotifyLibraryHasMore = false;
      spotifyLibraryError = "";
    }
    spotifyLibraryLoading = true;
    var offset = reset ? 0 : spotifyLibraryOffset;
    return spotifyApi("/me/tracks?limit=25&offset=" + String(offset))
      .then(function (data) {
        var items = data && Array.isArray(data.items) ? data.items : [];
        var tracks = [];
        for (var i = 0; i < items.length; i++) {
          var row = items[i];
          if (row && row.track && row.track.uri) tracks.push(row.track);
        }
        if (reset) spotifyLibraryItems = tracks;
        else spotifyLibraryItems = spotifyLibraryItems.concat(tracks);
        spotifyLibraryOffset = offset + items.length;
        spotifyLibraryHasMore = !!(data && data.next);
        spotifyLibraryError = "";
      })
      .catch(function (err) {
        spotifyLibraryError = err && err.message ? err.message : "Could not load Spotify library.";
      })
      .then(function () {
        spotifyLibraryLoading = false;
      });
  }

  function spotifyPlaybackUri(uri) {
    if (!uri) return Promise.reject(new Error("missing spotify uri"));
    return ensureSpotifyPlayer()
      .then(function () {
        return waitForSpotifyDevice(5000);
      })
      .then(function (deviceId) {
        return spotifyApi("/me/player/play?device_id=" + encodeURIComponent(deviceId), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uris: [uri] }),
        });
      });
  }

  function spotifyAddUriToQueue(uri) {
    if (!uri) return Promise.reject(new Error("missing spotify uri"));
    return ensureSpotifyPlayer()
      .then(function () {
        return waitForSpotifyDevice(5000);
      })
      .then(function (deviceId) {
        var qs = new URLSearchParams({ uri: uri, device_id: deviceId });
        return spotifyApi("/me/player/queue?" + qs.toString(), { method: "POST" });
      });
  }

  function renderSpotifyQueueList(chIdx) {
    if (!queueListEl || !queueHeading) return;
    var label = chIdx === 0 ? "Left Spotify queue" : "Right Spotify queue";
    queueHeading.textContent = label;
    queueHeading.style.color = chIdx === 0 ? "var(--beta-left)" : "var(--beta-right)";
    queueListEl.innerHTML = "";
    var rows = [];
    if (spotifyQueueNowPlaying) rows.push({ item: spotifyQueueNowPlaying, now: true });
    for (var i = 0; i < spotifyQueueItems.length; i++) rows.push({ item: spotifyQueueItems[i], now: false });
    if (queueEmptyEl) {
      queueEmptyEl.hidden = rows.length > 0;
      if (rows.length === 0) {
        var titleEl = queueEmptyEl.querySelector(".beta-queue-empty-title");
        var hintEl = queueEmptyEl.querySelector(".beta-queue-empty-hint");
        if (titleEl) titleEl.textContent = "Spotify queue unavailable";
        if (hintEl) hintEl.textContent = "Open Spotify and start playback, then retry Queue.";
      }
    }
    for (var r = 0; r < rows.length; r++) {
      var rowData = rows[r];
      var row = document.createElement("div");
      row.className = "beta-queue-row" + (rowData.now ? " beta-queue-row--current" : "");
      row.setAttribute("role", "listitem");
      var idxEl = document.createElement("span");
      idxEl.className = "beta-queue-row-idx";
      idxEl.textContent = rowData.now ? "Now" : String(r + 1);
      var title = document.createElement("span");
      title.className = "beta-queue-row-title";
      title.textContent = spotifyTrackName(rowData.item);
      var artist = spotifyTrackArtist(rowData.item);
      if (artist) title.textContent += " - " + artist;
      row.appendChild(idxEl);
      row.appendChild(title);
      queueListEl.appendChild(row);
    }
  }

  function renderSpotifyLibraryList(chIdx) {
    if (!queueListEl || !queueHeading) return;
    var label = chIdx === 0 ? "Left Spotify library" : "Right Spotify library";
    queueHeading.textContent = label;
    queueHeading.style.color = chIdx === 0 ? "var(--beta-left)" : "var(--beta-right)";
    queueListEl.innerHTML = "";
    if (queueEmptyEl) {
      var empty = !spotifyLibraryLoading && spotifyLibraryItems.length === 0;
      var loadingEmpty = spotifyLibraryLoading && spotifyLibraryItems.length === 0;
      queueEmptyEl.hidden = !(empty || loadingEmpty);
      if (loadingEmpty) {
        var loadingTitleEl = queueEmptyEl.querySelector(".beta-queue-empty-title");
        var loadingHintEl = queueEmptyEl.querySelector(".beta-queue-empty-hint");
        if (loadingTitleEl) loadingTitleEl.textContent = "Loading Spotify library";
        if (loadingHintEl) loadingHintEl.textContent = "Fetching your saved tracks...";
      } else if (empty) {
        var titleEl = queueEmptyEl.querySelector(".beta-queue-empty-title");
        var hintEl = queueEmptyEl.querySelector(".beta-queue-empty-hint");
        if (spotifyLibraryError) {
          if (titleEl) titleEl.textContent = "Spotify library unavailable";
          if (hintEl) hintEl.textContent = spotifyLibraryError;
        } else {
          if (titleEl) titleEl.textContent = "No saved tracks found";
          if (hintEl) hintEl.textContent = "Save tracks in Spotify, then open Library again.";
        }
      }
    }
    for (var i = 0; i < spotifyLibraryItems.length; i++) {
      (function (rowIndex) {
        var item = spotifyLibraryItems[rowIndex];
        var row = document.createElement("div");
        row.className = "beta-queue-row";
        row.setAttribute("role", "listitem");
        var idxEl = document.createElement("span");
        idxEl.className = "beta-queue-row-idx";
        idxEl.textContent = String(rowIndex + 1);
        var titleBtn = document.createElement("button");
        titleBtn.type = "button";
        titleBtn.className = "beta-queue-row-title";
        titleBtn.textContent = spotifyTrackName(item);
        var artist = spotifyTrackArtist(item);
        if (artist) titleBtn.textContent += " - " + artist;
        titleBtn.addEventListener("click", function () {
          spotifyPlaybackUri(item.uri)
            .then(function () {
              setStatus("Playing from Spotify library.", false);
              fetchSpotifyQueue().then(function () {
                refreshQueuePanelIfOpen();
              });
            })
            .catch(function (err) {
              var msg = err && err.message ? err.message : "Could not play Spotify track.";
              setStatus(msg, true);
            });
        });
        var addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "beta-queue-row-action";
        addBtn.textContent = "Add";
        addBtn.setAttribute("aria-label", "Add track to Spotify queue");
        addBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          spotifyAddUriToQueue(item.uri)
            .then(function () {
              setStatus("Added to Spotify queue.", false);
              fetchSpotifyQueue().then(function () {
                refreshQueuePanelIfOpen();
              });
            })
            .catch(function (err) {
              var msg = err && err.message ? err.message : "Could not add track to Spotify queue.";
              setStatus(msg, true);
            });
        });
        row.appendChild(idxEl);
        row.appendChild(titleBtn);
        row.appendChild(addBtn);
        queueListEl.appendChild(row);
      })(i);
    }
  }

  function renderQueueList() {
    if (!queueListEl || !queueHeading || !queuePanelChannel) return;
    var chIdx = sideToIdx(queuePanelChannel);
    updateQueueViewControls(chIdx);
    if (channelMode[chIdx] === "spotify") {
      updateQueueHeaderButtons(chIdx);
      if (queuePanelView === "library") {
        renderSpotifyLibraryList(chIdx);
        if (!spotifyLibraryLoading && spotifyLibraryItems.length === 0 && !spotifyLibraryError) {
          fetchSpotifyLibrary({ reset: true }).then(function () {
            renderSpotifyLibraryList(chIdx);
            updateQueueViewControls(chIdx);
          });
        }
      } else {
        fetchSpotifyQueue().then(function () {
          renderSpotifyQueueList(chIdx);
        });
      }
      return;
    }
    var q = getQueue(chIdx);
    var cur = channelCurrentIndex[chIdx];

    if (queueHeading) {
      queueHeading.textContent = queuePanelChannel === "left" ? "Left queue" : "Right queue";
      queueHeading.style.color = queuePanelChannel === "left" ? "var(--beta-left)" : "var(--beta-right)";
    }

    updateQueueHeaderButtons(chIdx);
    updateQueueViewControls(chIdx);

    if (queueEmptyEl) {
      queueEmptyEl.hidden = q.length > 0;
      var titleEl = queueEmptyEl.querySelector(".beta-queue-empty-title");
      var hintEl = queueEmptyEl.querySelector(".beta-queue-empty-hint");
      if (titleEl) titleEl.textContent = "Queue is empty";
      if (hintEl) hintEl.textContent = "Add files with Add or drag audio onto a channel.";
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
    queuePanelView = "queue";
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
    queuePanelView = "queue";
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
      var cur = el.currentTime;
      var d = el.duration;
      if (channelMode[idx] === "spotify" && spotifyChannelIdx === idx && spotifyState) {
        cur = Math.max(0, Number(spotifyState.position || 0) / 1000);
        d = Math.max(0, Number(spotifyState.duration || 0) / 1000);
      }
      u.seek.max = Number.isFinite(d) && d > 0 ? d : 0;
      if (!u.seek.dataset.dragging) u.seek.value = String(cur || 0);
      u.timeEl.textContent = formatTime(cur);
      u.timeDur.textContent = formatTime(Number.isFinite(d) ? d : 0);
      var wrap = u.seek.closest(".beta-progress-wrap");
      if (wrap && wrap.style) {
        var pct = 0;
        if (Number.isFinite(d) && d > 0) {
          pct = Math.max(0, Math.min(100, ((cur || 0) / d) * 100));
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

  function spotifySeekRelative(deltaSec) {
    if (!spotifyPlayer) return Promise.resolve();
    return spotifyPlayer.getCurrentState().then(function (state) {
      if (!state) return;
      if (state.disallows && state.disallows.seeking) return;
      var duration = Math.max(0, Number(state.duration || 0));
      var nextMs = Math.max(0, Number(state.position || 0) + deltaSec * 1000);
      if (duration > 0) nextMs = Math.min(duration, nextMs);
      return spotifyPlayer.seek(nextMs);
    });
  }

  function spotifySkip(direction) {
    if (!spotifyPlayer) return Promise.resolve();
    return spotifyPlayer.getCurrentState().then(function (state) {
      if (!state) return;
      var dis = state.disallows || {};
      if (direction < 0) {
        if (dis.skipping_prev) return;
        return spotifyPlayer.previousTrack();
      }
      if (dis.skipping_next) return;
      return spotifyPlayer.nextTrack();
    });
  }

  function spotifySetVolume(chIdx, value) {
    if (channelMode[chIdx] !== "spotify" || !spotifyPlayer) return Promise.resolve();
    var clamped = Math.max(0, Math.min(1, value));
    return spotifyPlayer.setVolume(clamped);
  }

  function disableSpotifyMode(chIdx) {
    if (channelMode[chIdx] !== "spotify") return;
    channelMode[chIdx] = "local";
    if (spotifyChannelIdx === chIdx) spotifyChannelIdx = null;
    setStatus("");
    refreshModeUi();
    refreshQueuePanelIfOpen();
  }

  function enableSpotifyMode(chIdx) {
    if (channelMode[chIdx] === "spotify") {
      disableSpotifyMode(chIdx);
      return Promise.resolve();
    }
    var other = chIdx === 0 ? 1 : 0;
    if (channelMode[other] === "spotify") disableSpotifyMode(other);
    localPanBeforeSpotify[chIdx] = ui[channelSideByIdx(chIdx)].pan ? parseFloat(ui[channelSideByIdx(chIdx)].pan.value) || 0 : 0;
    channelMode[chIdx] = "spotify";
    spotifyChannelIdx = chIdx;
    refreshModeUi();
    setStatus("Spotify connected. Initializing player...", false);
    return ensureSpotifyPlayer()
      .then(function () {
        return waitForSpotifyDevice(5000);
      })
      .then(function (deviceId) {
        return transferSpotifyPlayback(deviceId, false);
      })
      .then(function () {
        pollSpotifyPlaybackState();
        setStatus("Spotify connected on " + channelSideByIdx(chIdx) + " channel.", false);
      })
      .catch(function (err) {
        disableSpotifyMode(chIdx);
        var msg = err && err.message ? err.message : "Could not enable Spotify.";
        setStatus(msg, true);
      });
  }

  function initSpotifyAuthFromUrl() {
    loadSpotifyAuthFromStorage();
    if (typeof window === "undefined") return Promise.resolve();
    var params = new URLSearchParams(window.location.search);
    var code = params.get("code");
    var state = params.get("state");
    var expectedState = sessionStorage.getItem(spotifyStorageKey("oauth_state"));
    if (!code) return Promise.resolve();
    if (!state || !expectedState || state !== expectedState) {
      setStatus("Spotify login state mismatch. Try reconnecting.", true);
      clearSpotifyOauthTransient();
      return Promise.resolve();
    }
    return exchangeSpotifyCodeForToken(code)
      .then(function (payload) {
        applyTokenPayload(payload);
        clearSpotifyOauthTransient();
        params.delete("code");
        params.delete("state");
        var next = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
        window.history.replaceState({}, document.title, next);
        var pendingChannel = consumeSpotifyPendingChannel();
        if (pendingChannel === 0 || pendingChannel === 1) {
          return enableSpotifyMode(pendingChannel);
        }
        setStatus("Spotify connected. Tap Spotify to start playback.", false);
      })
      .catch(function () {
        setStatus("Spotify login failed. Try again.", true);
      });
  }

  function updatePlayLabels() {
    ["left", "right"].forEach(function (side) {
      var idx = side === "left" ? 0 : 1;
      var u = ui[side];
      var a = audios[idx];
      if (u.playBtn && a) {
        var playing = !a.paused;
        if (channelMode[idx] === "spotify" && spotifyChannelIdx === idx && spotifyState) {
          playing = !spotifyState.paused;
        }
        u.playBtn.innerHTML =
          '<svg class="ionicon beta-play-glyph" width="68" height="68" viewBox="0 0 512 512" aria-hidden="true">' +
          channelPlayIcon(playing) +
          "</svg>";
        u.playBtn.setAttribute("aria-label", playing ? "Pause " + side + " channel" : "Play " + side + " channel");
      }
    });

    if (dualPlayBtn) {
      var leftPlaying = channelMode[0] === "spotify" && spotifyChannelIdx === 0 && spotifyState ? !spotifyState.paused : !audioLeft.paused;
      var rightPlaying = channelMode[1] === "spotify" && spotifyChannelIdx === 1 && spotifyState ? !spotifyState.paused : !audioRight.paused;
      var bothPlaying = leftPlaying && rightPlaying;
      dualPlayBtn.innerHTML =
        '<svg class="ionicon beta-dual-play-glyph" width="88" height="88" viewBox="0 0 512 512" aria-hidden="true">' +
        channelPlayIcon(bothPlaying) +
        "</svg>";
      dualPlayBtn.setAttribute("aria-label", bothPlaying ? "Pause both channels" : "Play both channels");
    }
  }

  function seekBurstRelative(chIdx, deltaSec) {
    if (channelMode[chIdx] === "spotify") {
      spotifySeekRelative(deltaSec).catch(function () {});
      return;
    }
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
    function onShortSkip(direction) {
      if (channelMode[chIdx] === "spotify") {
        spotifySkip(direction).catch(function () {});
        return;
      }
      if (direction < 0) skipToPreviousTrack(chIdx);
      else skipToNextTrack(chIdx);
    }

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
        onShortSkip(direction);
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
          onShortSkip(direction);
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
        if (channelMode[idx] === "spotify") disableSpotifyMode(idx);
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
        if (channelMode[idx] === "spotify") disableSpotifyMode(idx);
        loadFilesIntoChannel(idx, picked);
      });
      segmentEl.addEventListener("dragend", clearDropHover);
    }

    if (u.playBtn) {
      u.playBtn.addEventListener("click", function () {
        ensureGraph()
          .then(function () {
            var a = audios[idx];
            if (channelMode[idx] === "spotify") {
              return ensureSpotifyPlayer().then(function () {
                if (!spotifyPlayer) return;
                return spotifyPlayer.togglePlay();
              });
            }
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
            if (!Number.isFinite(v)) return;
            if (channelMode[idx] === "spotify") {
              ensureSpotifyPlayer()
                .then(function () {
                  if (!spotifyPlayer) return;
                  return spotifyPlayer.seek(Math.round(v * 1000));
                })
                .catch(function () {});
              return;
            }
            a.currentTime = v;
          })
          .catch(function () {});
      });
    }

    if (u.vol) {
      u.vol.addEventListener("input", function () {
        ensureGraph()
          .then(function () {
            var g = trackGains[idx];
            var v = parseFloat(u.vol.value);
            if (!Number.isFinite(v)) return;
            if (channelMode[idx] === "spotify") {
              spotifySetVolume(idx, v).catch(function () {});
              return;
            }
            if (!g) return;
            g.gain.value = v;
          })
          .catch(function () {});
      });
    }

    if (u.pan) {
      u.pan.addEventListener("input", function () {
        if (channelMode[idx] === "spotify") {
          setPanInputValue(u.pan, 0);
          return;
        }
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

    if (u.boost) {
      u.boost.addEventListener("click", function () {
        if (channelMode[idx] === "spotify") return;
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
        if (channelMode[idx] === "spotify") return;
        speedIdx[idx] = (speedIdx[idx] + 1) % speedPresets.length;
        var rate = speedPresets[speedIdx[idx]];
        audios[idx].playbackRate = rate;
        renderSpeedLabels();
      });
    }

    if (u.spotify) {
      u.spotify.addEventListener("click", function () {
        if (!showSpotifyConfigHintIfNeeded()) return;
        ensureSpotifyToken()
          .then(function () {
            return enableSpotifyMode(idx);
          })
          .catch(function () {
            return spotifyAuthStart(idx);
          });
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
      var leftAction =
        channelMode[0] === "spotify"
          ? ensureSpotifyPlayer().then(function () {
              if (!spotifyPlayer) return;
              return spotifyPlayer.getCurrentState().then(function (state) {
                if (!state || state.paused) return spotifyPlayer.resume();
                return spotifyPlayer.pause();
              });
            })
          : ensureGraph().then(function () {
              if (audioLeft.paused) return audioLeft.play();
              audioLeft.pause();
            });
      var rightAction =
        channelMode[1] === "spotify"
          ? ensureSpotifyPlayer().then(function () {
              if (!spotifyPlayer) return;
              return spotifyPlayer.getCurrentState().then(function (state) {
                if (!state || state.paused) return spotifyPlayer.resume();
                return spotifyPlayer.pause();
              });
            })
          : ensureGraph().then(function () {
              if (audioRight.paused) return audioRight.play();
              audioRight.pause();
            });
      Promise.all([leftAction, rightAction]).catch(function () {
        setStatus("Playback blocked or no audio loaded.", true);
      });
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
  if (queueViewQueueBtn) {
    queueViewQueueBtn.addEventListener("click", function () {
      setQueuePanelView("queue");
    });
  }
  if (queueViewLibraryBtn) {
    queueViewLibraryBtn.addEventListener("click", function () {
      if (!queuePanelChannel) return;
      var idx = sideToIdx(queuePanelChannel);
      if (channelMode[idx] !== "spotify") return;
      setQueuePanelView("library");
      if (!spotifyLibraryLoading && spotifyLibraryItems.length === 0) {
        fetchSpotifyLibrary({ reset: true }).then(function () {
          refreshQueuePanelIfOpen();
        });
      }
    });
  }
  if (queueLoadMoreBtn) {
    queueLoadMoreBtn.addEventListener("click", function () {
      if (!queuePanelChannel || queuePanelView !== "library") return;
      var idx = sideToIdx(queuePanelChannel);
      if (channelMode[idx] !== "spotify" || spotifyLibraryLoading || !spotifyLibraryHasMore) return;
      fetchSpotifyLibrary({ reset: false }).then(function () {
        refreshQueuePanelIfOpen();
      });
    });
  }
  if (queueClearBtn) {
    queueClearBtn.addEventListener("click", function () {
      if (!queuePanelChannel) return;
      var idx = sideToIdx(queuePanelChannel);
      if (channelMode[idx] === "spotify") {
        setStatus("Unsupported by Spotify", true);
        return;
      }
      clearChannelQueue(idx);
    });
  }
  if (queueShuffleBtn) {
    queueShuffleBtn.addEventListener("click", function () {
      if (!queuePanelChannel) return;
      var idx = sideToIdx(queuePanelChannel);
      if (channelMode[idx] === "spotify") return;
      toggleShuffleForChannel(idx);
    });
  }
  if (queueRepeatBtn) {
    queueRepeatBtn.addEventListener("click", function () {
      if (!queuePanelChannel) return;
      var idx = sideToIdx(queuePanelChannel);
      if (channelMode[idx] === "spotify") return;
      toggleRepeatForChannel(idx);
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

  initSpotifyAuthFromUrl()
    .then(function () {})
    .catch(function () {});

  requestAnimationFrame(loopSeek);
  renderTitles();
  renderSpeedLabels();
  setBoostUi(0);
  setBoostUi(1);
  refreshModeUi();
  showSpotifyConfigHintIfNeeded();
  updatePlayLabels();

  window.dicoticBeta = {
    ensureGraph: ensureGraph,
    swapQueues: swapQueues,
    openQueue: openQueuePanel,
    closeQueue: closeQueuePanel,
  };
})();
