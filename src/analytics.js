/* Anonymous click analytics for dicotic web pages (no cookies, no identifiers). */
(function () {
  "use strict";

  var ENDPOINT = "/api/collect";
  var SCHEMA_VERSION = "2026-05-05";
  var MAX_LABEL_LENGTH = 120;
  var ENABLED = true;

  function nowIsoMinute() {
    var d = new Date();
    d.setSeconds(0, 0);
    return d.toISOString();
  }

  function trimSafe(value, fallback) {
    if (typeof value !== "string") return fallback || "";
    var v = value.trim();
    if (!v) return fallback || "";
    return v.slice(0, MAX_LABEL_LENGTH);
  }

  function pagePath() {
    try {
      return (window.location && window.location.pathname) || "/";
    } catch (err) {
      return "/";
    }
  }

  function postPayload(payload) {
    if (!ENABLED || !payload) return;
    var body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      try {
        navigator.sendBeacon(ENDPOINT, body);
        return;
      } catch (err) {}
    }
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body,
      keepalive: true,
      credentials: "omit",
    }).catch(function () {});
  }

  function trackEvent(eventName, metadata) {
    var name = trimSafe(eventName, "");
    if (!name) return;
    var data = metadata || {};
    var payload = {
      schemaVersion: SCHEMA_VERSION,
      eventName: name,
      pagePath: trimSafe(data.pagePath, pagePath()),
      element: trimSafe(data.element, ""),
      href: trimSafe(data.href, ""),
      context: trimSafe(data.context, ""),
      occurredAtMinute: nowIsoMinute(),
    };
    postPayload(payload);
  }

  function bindAnchorClicks(options) {
    var root = (options && options.root) || document;
    var selector = (options && options.selector) || "a";
    var context = (options && options.context) || "link_click";
    root.querySelectorAll(selector).forEach(function (a) {
      a.addEventListener("click", function () {
        trackEvent("click", {
          context: context,
          element: a.id || a.className || "anchor",
          href: a.getAttribute("href") || "",
        });
      });
    });
  }

  function bindVideoPlays(selector, context) {
    document.querySelectorAll(selector).forEach(function (video, index) {
      video.addEventListener("play", function () {
        trackEvent("video_play", {
          context: context || "tutorial_video",
          element: video.id || "video_" + String(index + 1),
        });
      });
      video.addEventListener("ended", function () {
        trackEvent("video_end", {
          context: context || "tutorial_video",
          element: video.id || "video_" + String(index + 1),
        });
      });
    });
  }

  window.dicoticAnalytics = {
    endpoint: ENDPOINT,
    schemaVersion: SCHEMA_VERSION,
    trackEvent: trackEvent,
    bindAnchorClicks: bindAnchorClicks,
    bindVideoPlays: bindVideoPlays,
  };
})();
