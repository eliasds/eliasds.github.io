/**
 * dicotic Try Portal — deterministic playback rules (no DOM, no Spotify SDK).
 * Host script binds globals and I/O; this module holds transport math and swap slices.
 */
(function (global) {
  "use strict";

  /**
   * Local channel speed button cycles presets when true. When false, host pins 1× and
   * ignores SPEED_STEP (re-enable: set true, restore wireChannel + applySpeedStepIntent).
   */
  var LOCAL_SPEED_STEP_ENABLED = true;

  var INTENT = {
    PLAY_PAUSE: "PLAY_PAUSE",
    DUAL_TOGGLE: "DUAL_TOGGLE",
    SWAP_CHANNELS: "SWAP_CHANNELS",
    SHUFFLE_TOGGLE: "SHUFFLE_TOGGLE",
    QUEUE_NEXT: "QUEUE_NEXT",
    QUEUE_PREV: "QUEUE_PREV",
  };

  /**
   * @param {{ queueLen: number, index: number, playing: boolean }} s
   */
  function transportAfterTrackEnded(s) {
    var q = s.queueLen;
    var index = s.index;
    if (index < q - 1) {
      return { index: index + 1, seekTo: null, doPlay: s.playing, pause: false };
    }
    return { index: index, seekTo: null, doPlay: false, pause: true };
  }

  /**
   * @param {{ queueLen: number, index: number, playing: boolean }} s
   */
  function transportManualNext(s) {
    var q = s.queueLen;
    if (q === 0) return { noop: true };
    var index = s.index;
    var playing = s.playing;
    if (index < q - 1) {
      return { index: index + 1, seekTo: null, doPlay: playing, pause: false };
    }
    return { pause: true, doPlay: false };
  }

  /**
   * @param {{ queueLen: number, index: number, playing: boolean }} s
   */
  function transportManualPrev(s) {
    var q = s.queueLen;
    if (q === 0) return { noop: true };
    var index = s.index;
    var playing = s.playing;
    if (index > 0) {
      return { index: index - 1, seekTo: null, doPlay: playing, pause: false };
    }
    return { index: index, seekTo: 0, doPlay: playing, pause: false };
  }

  /**
   * Next index when shuffle is on: uniform random; if queueLen > 1, avoid repeating current index.
   * @param {{ queueLen: number, currentIndex: number }} s
   * @returns {number}
   */
  function randomShuffleAdvanceIndex(s) {
    var q = s.queueLen;
    var cur = s.currentIndex;
    if (q <= 0) return 0;
    if (q === 1) return 0;
    var j;
    do {
      j = Math.floor(Math.random() * q);
    } while (j === cur);
    return j;
  }

  /**
   * One channel worth of swappable fields (references, not deep-cloned File contents).
   * @typedef {{
   *   queueFiles: unknown[],
   *   currentIndex: number,
   *   shuffleEnabled: boolean,
   *   lastBlobUrl: string,
   *   sourceKind: string,
   *   portalState: unknown,
   *   trackMeta: { title: string, artist: string },
   *   speedIdx: number,
   *   volValue: string,
   *   panValue: string,
   *   playingIntent: boolean,
   * }} ChannelSwapSlice
   */

  /**
   * @param {ChannelSwapSlice} a
   * @param {ChannelSwapSlice} b
   * @returns {{ left: ChannelSwapSlice, right: ChannelSwapSlice }}
   */
  function swapChannelSlices(a, b) {
    return { left: b, right: a };
  }

  /** @param {number} minMs */
  function createTapGuard(minMs) {
    var last = Object.create(null);
    return function (key) {
      var now = Date.now();
      var prev = last[key] || 0;
      if (now - prev < minMs) return false;
      last[key] = now;
      return true;
    };
  }

  /**
   * Spotify channel capabilities (host still owns SDK).
   */
  var SPOTIFY_CHANNEL = {
    kind: "portal",
    speedSupported: false,
    volumeViaSdk: true,
  };

  global.dicoticPortalEngine = {
    LOCAL_SPEED_STEP_ENABLED: LOCAL_SPEED_STEP_ENABLED,
    INTENT: INTENT,
    SPOTIFY_CHANNEL: SPOTIFY_CHANNEL,
    transportAfterTrackEnded: transportAfterTrackEnded,
    transportManualNext: transportManualNext,
    transportManualPrev: transportManualPrev,
    randomShuffleAdvanceIndex: randomShuffleAdvanceIndex,
    swapChannelSlices: swapChannelSlices,
    createTapGuard: createTapGuard,
  };
})(typeof window !== "undefined" ? window : globalThis);
