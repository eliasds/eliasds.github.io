/**
 * Web beta — Spotify OAuth (PKCE), Web Playback SDK, transfer, modal sheet, portal callbacks.
 * Host passes DOM refs and channel mutations (setSideSource, updatePortalSideState).
 */
(function (global) {
  "use strict";

  var SPOTIFY_REDIRECT_URI = "https://dicotic.com/try/";
  var SPOTIFY_SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
  ].join(" ");

  /**
   * @param {Object} host
   * @param {(msg: string, isError?: boolean) => void} host.setStatus
   * @param {(side: string) => number} host.sideToIdx
   * @param {(idx: number) => string} host.idxToSide
   * @param {(idx: number) => boolean} host.isPortalChannel
   * @param {(idx: number) => boolean} host.isIOSSpotifyVolumeLocked
   * @param {(side: string, descriptor: object) => void} host.setSideSource
   * @param {(side: string, patch: object) => void} host.updatePortalSideState
   * @param {(idx: number) => object | null} host.getPortalState
   * @param {(idx: number) => number} host.getVolSliderValue
   * @param {(side: string) => HTMLElement | null} host.spotifyButton
   * @param {{ root: HTMLElement | null, backdrop: HTMLElement | null, panel: HTMLElement | null, title: HTMLElement | null, closeBtn: HTMLElement | null, transferBtn: HTMLElement | null, disableBtn: HTMLElement | null, hint: HTMLElement | null }} host.dom
   */
  function create(host) {
    var dom = host.dom;

    var runtime = {
      sdkPromise: null,
      player: null,
      deviceId: "",
      activeSide: /** @type {'left'|'right'|null} */ (null),
      lastState: null,
      lastStateAtMs: 0,
      basePositionSec: 0,
      ticker: null,
      tokenValue: "",
      tokenExpiresAt: 0,
      transferBusy: false,
      modalSide: /** @type {'left'|'right'|null} */ (null),
      modalLoading: false,
      modalError: "",
    };
    var auth = {
      accessToken: "",
      refreshToken: "",
      expiresAt: 0,
    };

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
      auth.accessToken = parsed.accessToken || "";
      auth.refreshToken = parsed.refreshToken || "";
      auth.expiresAt = parsed.expiresAt || 0;
    } catch (e) {}
  }

  function saveSpotifyAuthToStorage() {
    try {
      sessionStorage.setItem(spotifyStorageKey("auth"), JSON.stringify(auth));
    } catch (e) {}
  }

  function syncSpotifyRuntimeToken() {
    runtime.tokenValue = auth.accessToken || "";
    runtime.tokenExpiresAt = Number.isFinite(auth.expiresAt) ? auth.expiresAt : 0;
  }

  function clearSpotifyAuth() {
    auth.accessToken = "";
    auth.refreshToken = "";
    auth.expiresAt = 0;
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

  function authStart(side) {
    var clientId = getSpotifyClientId();
    if (!clientId) {
      host.setStatus("Spotify client ID is missing. Set window.__SPOTIFY_CLIENT_ID__.", true);
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
    if (!auth.refreshToken) return Promise.reject(new Error("missing refresh token"));
    var clientId = getSpotifyClientId();
    var body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken,
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
    auth.accessToken = payload.access_token || "";
    if (payload.refresh_token) auth.refreshToken = payload.refresh_token;
    var expiresIn = Number(payload.expires_in || 3600);
    auth.expiresAt = Date.now() + Math.max(60, expiresIn - 30) * 1000;
    saveSpotifyAuthToStorage();
    syncSpotifyRuntimeToken();
  }

  function ensureSpotifyToken() {
    if (auth.accessToken && Date.now() < auth.expiresAt) {
      syncSpotifyRuntimeToken();
      return Promise.resolve(auth.accessToken);
    }
    if (auth.refreshToken) {
      return refreshSpotifyToken()
        .then(function (payload) {
          applyTokenPayload(payload);
          return auth.accessToken;
        })
        .catch(function () {
          clearSpotifyAuth();
          throw new Error("no spotify auth");
        });
    }
    return Promise.reject(new Error("no spotify auth"));
  }

  function initAuthFromUrl() {
    loadSpotifyAuthFromStorage();
    syncSpotifyRuntimeToken();
    var params = new URLSearchParams(window.location.search);
    var code = params.get("code");
    var state = params.get("state");
    if (!code) return Promise.resolve();
    var expectedState = sessionStorage.getItem(spotifyStorageKey("oauth_state")) || "";
    if (!state || !expectedState || state !== expectedState) {
      host.setStatus("Spotify login failed. Try again.", true);
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
          return enableOnSide(side);
        }
      })
      .catch(function () {
        host.setStatus("Spotify login failed. Try again.", true);
      });
  }

  function setSpotifyBtnState(side, isActive, isBusy) {
    var btn = host.spotifyButton(side);
    if (!btn) return;
    btn.classList.toggle("beta-small-btn--active", !!isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    btn.disabled = !!isBusy;
    btn.setAttribute("aria-label", (isActive ? "Disable" : "Enable") + " Spotify on " + side + " channel");
  }

  function refreshSpotifyButtons() {
    var active = runtime.activeSide;
    setSpotifyBtnState("left", active === "left" && host.isPortalChannel(0), false);
    setSpotifyBtnState("right", active === "right" && host.isPortalChannel(1), false);
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
    if (runtime.ticker !== null) {
      clearInterval(runtime.ticker);
      runtime.ticker = null;
    }
  }

  function computeSpotifyPatchFromRuntime() {
    if (!runtime.lastState) return null;
    var patch = readTrackFromState(runtime.lastState);
    var base = Number.isFinite(runtime.basePositionSec) ? runtime.basePositionSec : patch.currentTime;
    if (!Number.isFinite(base) || base < 0) base = 0;
    if (patch.isPlaying && runtime.lastStateAtMs > 0) {
      var elapsedSec = Math.max(0, (Date.now() - runtime.lastStateAtMs) / 1000);
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
    runtime.ticker = setInterval(function () {
      if (!runtime.lastState || !runtime.activeSide) return;
      var side = runtime.activeSide;
      var idx = host.sideToIdx(side);
      if (!host.isPortalChannel(idx)) return;
      var patch = computeSpotifyPatchFromRuntime();
      if (!patch) return;
      var existing = host.getPortalState(idx);
      if (patch.isPlaying && existing && Number.isFinite(existing.currentTime) && patch.currentTime < existing.currentTime) {
        patch.currentTime = existing.currentTime;
      }
      host.updatePortalSideState(side, patch);
    }, 500);
  }

  function applySpotifyStateToActiveSide() {
    if (!runtime.activeSide || !runtime.lastState) return;
    var side = runtime.activeSide;
    var idx = host.sideToIdx(side);
    if (!host.isPortalChannel(idx)) return;
    var patch = computeSpotifyPatchFromRuntime();
    if (!patch) return;
    patch.playbackRate = 1;
    patch.canSeek = true;
    host.updatePortalSideState(side, patch);
    if (patch.isPlaying) startSpotifyTicker();
    else stopSpotifyTicker();
  }

  function getSpotifyToken() {
    var now = Date.now();
    if (runtime.tokenValue && runtime.tokenExpiresAt > now + 5000) {
      return Promise.resolve(runtime.tokenValue);
    }
    var conf = getSpotifyConfig();
    if (typeof conf.getAccessToken === "function") {
      return Promise.resolve()
        .then(function () {
          return conf.getAccessToken();
        })
        .then(function (result) {
          if (typeof result === "string") {
            runtime.tokenValue = result;
            runtime.tokenExpiresAt = now + 50 * 60 * 1000;
            return runtime.tokenValue;
          }
          if (result && typeof result.token === "string") {
            runtime.tokenValue = result.token;
            var ttlSec = Number.isFinite(result.expiresInSec) ? result.expiresInSec : 3000;
            runtime.tokenExpiresAt = now + Math.max(60, ttlSec) * 1000;
            return runtime.tokenValue;
          }
          throw new Error("Spotify token provider returned invalid payload");
        });
    }
    return ensureSpotifyToken().then(function (token) {
      runtime.tokenValue = token;
      runtime.tokenExpiresAt = auth.expiresAt || now + 60 * 1000;
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
    if (runtime.deviceId) return Promise.resolve(runtime.deviceId);
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      var t = setInterval(function () {
        if (runtime.deviceId) {
          clearInterval(t);
          resolve(runtime.deviceId);
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
    var did = deviceId || runtime.deviceId;
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
    var side = host.idxToSide(idx);
    var tasks = [];
    if (runtime.player && typeof runtime.player.setVolume === "function") {
      tasks.push(runtime.player.setVolume(clamped));
    }
    // API fallback keeps device volume in sync when SDK volume alone is not enough.
    tasks.push(
      setSpotifyDeviceVolume(clamped, { deviceId: runtime.deviceId }).catch(function () {
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
    runtime.modalLoading = !!isLoading;
    if (dom.transferBtn) dom.transferBtn.disabled = runtime.modalLoading;
    if (dom.disableBtn) dom.disableBtn.disabled = runtime.modalLoading;
    if (dom.hint) {
      if (runtime.modalLoading) dom.hint.textContent = "Working…";
      else if (runtime.modalError) dom.hint.textContent = runtime.modalError;
      else {
        var side = runtime.modalSide;
        var idx = side ? host.sideToIdx(side) : -1;
        if (idx >= 0 && host.isIOSSpotifyVolumeLocked(idx)) {
          dom.hint.textContent =
            "On iOS, Spotify volume is controlled by hardware buttons or the Spotify app. Channel volume slider is disabled.";
        } else {
          dom.hint.textContent =
            "Connect sends playback to this browser. Use channel controls for play, pause, seek, and queue.";
        }
      }
    }
  }

  function renderSpotifyModalTitle(side) {
    if (!dom.title) return;
    var isLeft = side === "left";
    dom.title.innerHTML =
      '<span class="beta-spotify-title-side ' +
      (isLeft ? "beta-spotify-title-side--left" : "beta-spotify-title-side--right") +
      '">' +
      (isLeft ? "Left" : "Right") +
      '</span><span class="beta-spotify-title-sep">:</span><span class="beta-spotify-title-brand">Spotify</span>';
    dom.title.setAttribute("aria-label", (isLeft ? "Left" : "Right") + ": Spotify");
  }

  function closeSpotifySheet() {
    if (!dom.root) return;
    dom.root.hidden = true;
    dom.root.setAttribute("aria-hidden", "true");
    document.body.classList.remove("beta-spotify-open");
    runtime.modalSide = null;
    runtime.modalError = "";
    setSpotifyModalLoading(false);
  }

  function openSpotifySheet(side) {
    if (!dom.root) return;
    runtime.modalSide = side;
    runtime.modalError = "";
    if (dom.panel) dom.panel.setAttribute("data-channel", side);
    renderSpotifyModalTitle(side);
    dom.root.hidden = false;
    dom.root.setAttribute("aria-hidden", "false");
    document.body.classList.add("beta-spotify-open");
    setSpotifyModalLoading(false);
    if (dom.hint) {
      var idx = host.sideToIdx(side);
      if (host.isIOSSpotifyVolumeLocked(idx)) {
        dom.hint.textContent =
          "On iOS, Spotify volume is controlled by hardware buttons or the Spotify app. Channel volume slider is disabled.";
      } else {
        dom.hint.textContent =
          "Connect sends playback to this browser. Use channel controls for play, pause, seek, and queue.";
      }
    }
  }

  function transferPlaybackToCurrentDevice(silent) {
    if (runtime.transferBusy) return Promise.resolve();
    runtime.transferBusy = true;
    return waitForSpotifyDeviceId(5000)
      .then(function (did) {
        return transferSpotifyPlayback(did, false);
      })
      .then(function () {
        if (!silent) host.setStatus("Spotify transferred to this device.", false);
      })
      .catch(function (err) {
        var reason = err && err.message ? err.message : "unknown";
        if (typeof console !== "undefined" && console.error) {
          console.error("[Spotify transfer failure]", reason, err);
        }
        if (err && err.message === "spotify_scope_or_auth") {
          host.setStatus("Spotify permissions changed. Please sign in again.", true);
          return;
        }
        if (reason.indexOf("spotify api 403") === 0) {
          host.setStatus("Spotify rejected transfer (403). Premium/device permissions may block Web Playback.", true);
          if (runtime.activeSide) openSpotifySheet(runtime.activeSide);
          return;
        }
        if (!silent) {
          host.setStatus("Transfer failed (" + reason + "). Use Transfer in Spotify sheet.", true);
          if (runtime.activeSide) openSpotifySheet(runtime.activeSide);
        }
      })
      .finally(function () {
        runtime.transferBusy = false;
      });
  }

  function loadSpotifySdk() {
    if (getSdkGlobal()) return Promise.resolve(getSdkGlobal());
    if (runtime.sdkPromise) return runtime.sdkPromise;
    runtime.sdkPromise = new Promise(function (resolve, reject) {
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
    return runtime.sdkPromise;
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
        if (!runtime.player) return;
        if (nextPlaying) runtime.player.resume();
        else runtime.player.pause();
      },
      onSeek: function (seconds) {
        if (!runtime.player || !Number.isFinite(seconds)) return;
        runtime.player.seek(Math.floor(Math.max(0, seconds) * 1000));
      },
      onNext: function () {
        if (!runtime.player) return;
        runtime.player.nextTrack();
      },
      onPrev: function () {
        if (!runtime.player) return;
        runtime.player.previousTrack();
      },
      onSetSpeed: function () {},
      onSwapToSide: function (nextSide) {
        runtime.activeSide = nextSide;
        refreshSpotifyButtons();
        applySpotifyStateToActiveSide();
      },
    };
  }

  function initSpotifyPlayer() {
    if (runtime.player) return Promise.resolve(runtime.player);
    return loadSpotifySdk().then(function (SpotifyNS) {
      if (!SpotifyNS || typeof SpotifyNS.Player !== "function") {
        throw new Error("Spotify SDK unavailable");
      }
      var conf = getSpotifyConfig();
      var playerName = conf.playerName || "dicotic Web beta";
      runtime.player = new SpotifyNS.Player({
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

      runtime.player.addListener("ready", function (payload) {
        runtime.deviceId = payload && payload.device_id ? payload.device_id : "";
        host.setStatus("Spotify player ready. Transfer playback to this device in Spotify.", false);
      });
      runtime.player.addListener("not_ready", function () {
        runtime.deviceId = "";
      });
      runtime.player.addListener("player_state_changed", function (state) {
        runtime.lastState = state || null;
        runtime.lastStateAtMs = Date.now();
        runtime.basePositionSec = state && Number.isFinite(state.position) ? state.position / 1000 : 0;
        applySpotifyStateToActiveSide();
      });
      runtime.player.addListener("authentication_error", function (e) {
        clearSpotifyAuth();
        host.setStatus("Spotify auth error: " + (e && e.message ? e.message : "unknown"), true);
      });
      runtime.player.addListener("account_error", function (e2) {
        host.setStatus("Spotify account error: " + (e2 && e2.message ? e2.message : "Premium required"), true);
      });
      runtime.player.addListener("initialization_error", function (e3) {
        host.setStatus("Spotify init error: " + (e3 && e3.message ? e3.message : "unknown"), true);
      });
      runtime.player.addListener("playback_error", function (e4) {
        host.setStatus("Spotify playback error: " + (e4 && e4.message ? e4.message : "unknown"), true);
      });

      return runtime.player.connect().then(function (ok) {
        if (!ok) throw new Error("Spotify connect failed");
        return runtime.player;
      });
    });
  }

  function enableOnSide(side) {
    var targetIdx = host.sideToIdx(side);
    var otherSide = side === "left" ? "right" : "left";
    var otherIdx = host.sideToIdx(otherSide);
    setSpotifyBtnState("left", false, true);
    setSpotifyBtnState("right", false, true);
    return initSpotifyPlayer()
      .then(function () {
        if (host.isPortalChannel(otherIdx)) {
          host.setSideSource(otherSide, { sourceKind: "local" });
        }
        runtime.activeSide = side;
        host.setSideSource(side, buildSpotifyPortalDescriptor());
        applySpotifyStateToActiveSide();
        refreshSpotifyButtons();
        host.setStatus("Spotify enabled on " + side + " channel. Transferring playback...", false);
        return transferPlaybackToCurrentDevice(false);
      })
      .then(function () {
        return setSpotifyVolumeFromChannel(targetIdx, host.getVolSliderValue(targetIdx));
      })
      .then(function () {
        openSpotifySheet(side);
      })
      .catch(function (err) {
        host.setStatus("Could not enable Spotify: " + (err && err.message ? err.message : "unknown"), true);
        refreshSpotifyButtons();
      });
  }

  function disableOnSide(side) {
    var idx = host.sideToIdx(side);
    if (!host.isPortalChannel(idx)) return;
    if (runtime.activeSide === side) runtime.activeSide = null;
    host.setSideSource(side, { sourceKind: "local" });
    stopSpotifyTicker();
    if (runtime.player) {
      runtime.player.pause().catch(function () {});
    }
    refreshSpotifyButtons();
    host.setStatus("Spotify disabled on " + side + " channel.", false);
  }

    function bindChannelButton(side, idx) {
      var btn = host.spotifyButton(side);
      if (!btn) return;
      btn.addEventListener("click", function () {
        var portal = host.isPortalChannel(idx);
        if (portal) {
          ensureSpotifyToken()
            .then(function () {
              openSpotifySheet(side);
            })
            .catch(function (err) {
              if (isAuthMissingError(err) || (err && err.message === "spotify_scope_or_auth")) return spotifyAuthStart(side);
              host.setStatus("Could not open Spotify controls: " + (err && err.message ? err.message : "unknown"), true);
            });
          return;
        }
        ensureSpotifyToken()
          .then(function () {
            return enableOnSide(side);
          })
          .then(function () {
            openSpotifySheet(side);
          })
          .catch(function (err) {
            if (isAuthMissingError(err)) return spotifyAuthStart(side);
            host.setStatus("Could not start Spotify: " + (err && err.message ? err.message : "unknown"), true);
          });
      });
    }

    function wireModal() {
      if (dom.backdrop) {
        dom.backdrop.addEventListener("click", function () {
          closeSpotifySheet();
        });
      }
      if (dom.closeBtn) {
        dom.closeBtn.addEventListener("click", function () {
          closeSpotifySheet();
        });
      }
      if (dom.transferBtn) {
        dom.transferBtn.addEventListener("click", function () {
          setSpotifyModalLoading(true);
          transferPlaybackToCurrentDevice(false).finally(function () {
            setSpotifyModalLoading(false);
          });
        });
      }
      if (dom.disableBtn) {
        dom.disableBtn.addEventListener("click", function () {
          var side = runtime.modalSide;
          if (!side) return;
          disableOnSide(side);
          closeSpotifySheet();
        });
      }
    }

    return {
      refreshButtons: refreshSpotifyButtons,
      setVolumeFromChannel: setSpotifyVolumeFromChannel,
      initAuthFromUrl: initAuthFromUrl,
      bindChannelButton: bindChannelButton,
      wireModal: wireModal,
      closeSheet: closeSpotifySheet,
      getRoot: function () {
        return dom.root;
      },
    };
  }

  global.dicoticTryPortalSpotify = { create: create };
})(typeof window !== "undefined" ? window : globalThis);
