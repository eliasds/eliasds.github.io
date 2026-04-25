/**
 * Web beta queue overlay: open/close, list render, drag-reorder, shuffle header.
 * Host owns queue data and playback; this module owns panel visibility and list DOM.
 */
(function (global) {
  "use strict";

  /**
   * @param {Object} host
   * @param {{ root: HTMLElement | null, backdrop: HTMLElement | null, panel: HTMLElement | null, heading: HTMLElement | null, list: HTMLElement | null, emptyEl: HTMLElement | null, shuffleBtn: HTMLElement | null, closeBtn: HTMLElement | null, clearBtn: HTMLElement | null }} host.dom
   * @param {(side: string) => number} host.sideToIdx
   * @param {(chIdx: number) => boolean} host.isPortalChannel
   * @param {(chIdx: number) => Array<{ name?: string }>} host.getQueue
   * @param {(chIdx: number) => number} host.getCurrentIndex
   * @param {(chIdx: number, rowIndex: number) => void} host.playFromIndex
   * @param {(chIdx: number, rowIndex: number) => void} host.removeQueueItemAt
   * @param {(chIdx: number, fromIndex: number, toIndex: number) => void} host.reorderQueueItem
   * @param {(chIdx: number) => void} host.updateQueueHeaderButtons
   * @param {(chIdx: number) => void} host.toggleShuffleForChannel
   * @param {(chIdx: number) => void} host.clearChannelQueue
   */
  function create(host) {
    var dom = host.dom;
    /** @type {'left'|'right'|null} */
    var panelChannel = null;

    function isQueueDrawerLayout() {
      return typeof global.matchMedia === "function" && global.matchMedia("(min-width: 900px)").matches;
    }

    function syncQueueDrawerSideClass() {
      if (!dom.panel || !dom.root) return;
      dom.panel.classList.remove("beta-queue-panel--drawer-left", "beta-queue-panel--drawer-right");
      if (dom.root.hidden || !panelChannel) return;
      if (!isQueueDrawerLayout()) return;
      if (panelChannel === "left") dom.panel.classList.add("beta-queue-panel--drawer-left");
      else dom.panel.classList.add("beta-queue-panel--drawer-right");
    }

    function setQueueLayoutClass() {
      if (!dom.root) return;
      dom.root.classList.toggle("beta-queue-root--drawer", isQueueDrawerLayout());
      syncQueueDrawerSideClass();
    }

    function renderQueueList() {
      if (!dom.list || !dom.heading || !panelChannel) return;
      var chIdx = host.sideToIdx(panelChannel);
      var q = host.getQueue(chIdx);
      var cur = host.getCurrentIndex(chIdx);

      dom.heading.textContent = panelChannel === "left" ? "Left queue" : "Right queue";
      dom.heading.style.color = panelChannel === "left" ? "var(--beta-left)" : "var(--beta-right)";

      host.updateQueueHeaderButtons(chIdx);

      if (dom.emptyEl) {
        dom.emptyEl.hidden = q.length > 0;
      }
      dom.list.innerHTML = "";

      var portal = host.isPortalChannel(chIdx);

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
              host.reorderQueueItem(chIdx, from, to);
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
            host.playFromIndex(chIdx, rowIndex);
          });

          var del = document.createElement("button");
          del.type = "button";
          del.className = "beta-queue-row-delete";
          del.setAttribute("aria-label", "Remove from queue");
          del.innerHTML =
            '<svg class="ionicon" width="20" height="20" viewBox="0 0 512 512" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M112 112l20 320c0 8 8.7 16 16.7 16h214c8 0 16.7-8 16.7-16l20-320"/><path stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32" d="M80 112h352"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M192 112V72h0a23.93 23.93 0 0124-24h80a23.93 23.93 0 0124 24h0v40M169 169l22 22M323 323l22 22M237 288l42 42m0-42l-42 42"/></svg>';
          del.addEventListener("click", function (e) {
            e.stopPropagation();
            host.removeQueueItemAt(chIdx, rowIndex);
          });

          row.appendChild(idxEl);
          row.appendChild(titleBtn);
          row.appendChild(del);
          dom.list.appendChild(row);
        })(i);
      }
    }

    function refreshIfOpen() {
      if (panelChannel && dom.root && !dom.root.hidden) {
        renderQueueList();
      }
    }

    function open(side) {
      if (!dom.root || !dom.panel) return;
      panelChannel = side;
      dom.panel.setAttribute("data-channel", side);
      dom.root.hidden = false;
      dom.root.setAttribute("aria-hidden", "false");
      document.body.classList.add("beta-queue-open");
      setQueueLayoutClass();
      renderQueueList();
      if (dom.closeBtn) {
        try {
          dom.closeBtn.focus({ preventScroll: true });
        } catch (e) {
          dom.closeBtn.focus();
        }
      }
    }

    function close() {
      if (!dom.root) return;
      dom.root.hidden = true;
      dom.root.setAttribute("aria-hidden", "true");
      document.body.classList.remove("beta-queue-open");
      panelChannel = null;
      syncQueueDrawerSideClass();
    }

    function getPanelChannel() {
      return panelChannel;
    }

    function wire() {
      if (dom.backdrop) {
        dom.backdrop.addEventListener("click", function () {
          close();
        });
      }
      if (dom.closeBtn) {
        dom.closeBtn.addEventListener("click", function () {
          close();
        });
      }
      if (dom.clearBtn) {
        dom.clearBtn.addEventListener("click", function () {
          if (panelChannel) host.clearChannelQueue(host.sideToIdx(panelChannel));
        });
      }
      if (dom.shuffleBtn) {
        dom.shuffleBtn.addEventListener("click", function () {
          if (panelChannel) host.toggleShuffleForChannel(host.sideToIdx(panelChannel));
        });
      }
      global.addEventListener("resize", function () {
        if (!dom.root || dom.root.hidden) return;
        setQueueLayoutClass();
      });
    }

    return {
      open: open,
      close: close,
      refreshIfOpen: refreshIfOpen,
      setLayoutClass: setQueueLayoutClass,
      getPanelChannel: getPanelChannel,
      wire: wire,
      getRoot: function () {
        return dom.root;
      },
    };
  }

  global.dicoticTryPortalQueue = { create: create };
})(typeof window !== "undefined" ? window : globalThis);
