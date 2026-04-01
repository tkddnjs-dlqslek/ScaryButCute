/**
 * ScaryButCute - Content Script v11
 *
 * v10 → v11 변경:
 * - YouTube JS가 video 엘리먼트 크기를 리셋하는 문제 해결:
 *   MutationObserver로 video style 변경 감지 + 강제 override
 * - .html5-video-container 높이 0 문제 fix
 * - 활성화 후 window resize 이벤트 dispatch
 * - 비활성화 시 video/container 스타일도 완전 복원
 */

(function () {
  "use strict";

  console.log("[CV] v11 loaded");

  let VIDEO_WIDTH = 60;

  // ═══════════════════════════════════════
  //  테마별 이미지 가져오기 (전부 로컬 번들)
  // ═══════════════════════════════════════
  const TILE_COUNT = 80;

  function localImageUrls(animal, count) {
    const urls = [];
    for (let i = 1; i <= count; i++) {
      urls.push(chrome.runtime.getURL(`images/${animal}/${i}.jpg`));
    }
    // 매번 다른 배치로 셔플
    for (let i = urls.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [urls[i], urls[j]] = [urls[j], urls[i]];
    }
    return urls;
  }

  const THEME_FETCHERS = {
    dog: async (count) => localImageUrls("dog", count),
    cat: async (count) => localImageUrls("cat", count),
    fox: async (count) => localImageUrls("fox", count),
    capybara: async (count) => localImageUrls("capybara", count),
    rabbit: async (count) => localImageUrls("rabbit", count),
    red_panda: async (count) => localImageUrls("red_panda", count),
    ferret: async (count) => localImageUrls("ferret", count),
    snow_leopard: async (count) => localImageUrls("snow_leopard", count),
    mixed: async (count) => {
      const q = Math.ceil(count / 4);
      const dogs = localImageUrls("dog", q);
      const cats = localImageUrls("cat", q);
      const foxes = localImageUrls("fox", q);
      const capys = localImageUrls("capybara", q);
      const all = [];
      const sources = [dogs, cats, foxes, capys];
      for (let i = 0; i < count; i++) {
        const src = sources[i % sources.length];
        if (src.length > 0) all.push(src.shift());
      }
      // 믹스도 셔플
      for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
      }
      return all;
    },
  };

  let state = { enabled: false, animalTheme: "dog", active: false };
  let imageUrls = [];
  let prefetching = false;
  let originalParent = null;
  let originalNextSibling = null;
  let originalPlayerStyle = "";

  // video/container 강제 사이즈 관련
  let videoObserver = null;
  let videoForceInterval = null;

  function randomPastel() {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h}, 70%, 85%)`;
  }

  // ═══════════════════════════════════════
  //  프리페치
  // ═══════════════════════════════════════
  async function prefetch() {
    if (prefetching) return;
    prefetching = true;
    console.log("[CV] Prefetching:", state.animalTheme);
    try {
      const fetcher = THEME_FETCHERS[state.animalTheme] || THEME_FETCHERS.dog;
      imageUrls = await fetcher(TILE_COUNT);
      console.log("[CV] Got", imageUrls.length, "urls");
    } catch (e) {
      console.log("[CV] Prefetch error:", e.message);
      try {
        const res = await fetch("https://dog.ceo/api/breeds/image/random/50");
        const data = await res.json();
        imageUrls = data.message || [];
      } catch (_) { imageUrls = []; }
    }
    prefetching = false;
  }

  // ═══════════════════════════════════════
  //  영상 재생 중인지 감지
  // ═══════════════════════════════════════
  function getVideoSrc() {
    const video = document.querySelector("#movie_player video");
    return video && video.src ? true : false;
  }

  // ═══════════════════════════════════════
  //  video 엘리먼트 크기 강제 (YouTube JS 대항)
  // ═══════════════════════════════════════
  function forceVideoFill() {
    const frame = document.getElementById("cv-frame");
    if (!frame) return;
    const video = document.querySelector("#movie_player video");
    const container = document.querySelector(".html5-video-container");
    const fw = frame.offsetWidth;
    const fh = frame.offsetHeight;

    if (video) {
      video.style.setProperty("width", fw + "px", "important");
      video.style.setProperty("height", fh + "px", "important");
      video.style.setProperty("left", "0px", "important");
      video.style.setProperty("top", "0px", "important");
    }
    if (container) {
      container.style.setProperty("width", "100%", "important");
      container.style.setProperty("height", "100%", "important");
    }
  }

  function startVideoForcer() {
    stopVideoForcer();
    forceVideoFill();

    // MutationObserver: YouTube JS가 video style을 바꿀 때마다 강제
    const video = document.querySelector("#movie_player video");
    if (video) {
      videoObserver = new MutationObserver(() => forceVideoFill());
      videoObserver.observe(video, { attributes: true, attributeFilter: ["style"] });
    }

    // 백업: 500ms 간격으로도 강제 (광고 전환 등 대비)
    videoForceInterval = setInterval(forceVideoFill, 500);
  }

  function stopVideoForcer() {
    if (videoObserver) { videoObserver.disconnect(); videoObserver = null; }
    if (videoForceInterval) { clearInterval(videoForceInterval); videoForceInterval = null; }
  }

  // ═══════════════════════════════════════
  //  활성화
  // ═══════════════════════════════════════
  function activate() {
    if (state.active) return;
    const player = document.querySelector("#movie_player");
    if (!player) return;
    console.log("[CV] Activating...");

    // 새로고침 후 이전 wall 잔해 정리: player가 cv-frame 안에 있으면 먼저 복원
    const oldWall = document.getElementById("cv-wall");
    if (oldWall) {
      const defaultParent = document.querySelector('ytd-player#ytd-player #container')
          || document.querySelector('#ytd-player #container')
          || document.querySelector('#player-container #container');
      if (defaultParent) defaultParent.prepend(player);
      player.removeAttribute("style");
      oldWall.remove();
      document.body.style.removeProperty("overflow");
    }

    const playerRect = player.getBoundingClientRect();
    const playerAspect = playerRect.width / playerRect.height;
    console.log("[CV] Player:", playerRect.width.toFixed(0), "x", playerRect.height.toFixed(0), "aspect:", playerAspect.toFixed(3));

    originalParent = player.parentNode;
    originalNextSibling = player.nextSibling;
    originalPlayerStyle = player.getAttribute("style") || "";

    // ① 벽
    const wall = document.createElement("div");
    wall.id = "cv-wall";
    fillWall(wall);

    // ② 프레임 — 플레이어 원본 비율 기반
    const frame = document.createElement("div");
    frame.id = "cv-frame";
    const frameHeight = VIDEO_WIDTH / playerAspect;
    frame.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: ${VIDEO_WIDTH}vw;
      height: ${frameHeight}vw;
      z-index: 1000000;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 0 80px rgba(0,0,0,0.8);
      background: #000;
      clip-path: none !important;
    `;

    // ③ 영상 미재생 안내
    const noVideoMsg = document.createElement("div");
    noVideoMsg.id = "cv-no-video";
    noVideoMsg.style.cssText = `
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      color: rgba(255,255,255,0.7);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      z-index: 5; pointer-events: none;
      background: rgba(0,0,0,0.85);
      transition: opacity 0.3s;
    `;
    noVideoMsg.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 12px;">🐾</div>
      <div style="font-size: 18px; font-weight: 600; margin-bottom: 6px;">No video playing</div>
      <div style="font-size: 13px; color: rgba(255,255,255,0.4);">Play a YouTube video to watch in comfort mode</div>
    `;
    frame.appendChild(noVideoMsg);

    // ④ 플레이어 이동
    frame.appendChild(player);
    player.style.setProperty("width", "100%", "important");
    player.style.setProperty("height", "100%", "important");
    player.style.setProperty("position", "relative", "important");

    wall.appendChild(frame);
    document.body.appendChild(wall);
    document.body.style.setProperty("overflow", "hidden", "important");

    state.active = true;

    // ⑤ YouTube에게 리사이즈 알림 → 내부 레이아웃 재계산
    window.dispatchEvent(new Event("resize"));

    // ⑥ video 엘리먼트 크기 강제 (YouTube JS 대항)
    startVideoForcer();

    // ⑦ 영상 상태 감시
    startVideoWatcher();

    console.log("[CV] Activated! Frame:", VIDEO_WIDTH + "vw x " + frameHeight.toFixed(2) + "vw");
  }

  // ── 영상 상태 감시 ──
  let videoWatcherInterval = null;
  function startVideoWatcher() {
    stopVideoWatcher();
    updateNoVideoVisibility();
    videoWatcherInterval = setInterval(updateNoVideoVisibility, 1000);
  }

  function stopVideoWatcher() {
    if (videoWatcherInterval) {
      clearInterval(videoWatcherInterval);
      videoWatcherInterval = null;
    }
  }

  function updateNoVideoVisibility() {
    const msg = document.getElementById("cv-no-video");
    if (!msg) return;
    const hasVideo = getVideoSrc();
    msg.style.opacity = hasVideo ? "0" : "1";
    msg.style.pointerEvents = hasVideo ? "none" : "auto";
  }

  // ── 벽 이미지 채우기 ──
  function fillWall(wall) {
    wall.querySelectorAll(".cv-tile").forEach(t => t.remove());
    const urls = imageUrls.length > 0 ? imageUrls : [];
    const totalNeeded = TILE_COUNT;

    for (let i = 0; i < totalNeeded; i++) {
      const tile = document.createElement("div");
      tile.className = "cv-tile";
      tile.style.background = randomPastel();

      if (urls.length > 0) {
        const url = urls[i % urls.length];
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        img.draggable = false;
        img.style.opacity = "0";
        img.style.transition = "opacity 0.4s";
        img.onload = () => { img.style.opacity = "1"; };
        img.onerror = () => {};
        tile.appendChild(img);
      }

      wall.appendChild(tile);
    }
  }

  // ═══════════════════════════════════════
  //  비활성화
  // ═══════════════════════════════════════
  function deactivate() {
    stopVideoWatcher();
    stopVideoForcer();

    const wall = document.getElementById("cv-wall");
    const player = document.querySelector("#movie_player");

    // 영상 재생 상태 저장
    const video = document.querySelector("#movie_player video");
    const wasPlaying = video && !video.paused;

    // video/container 스타일 복원
    if (video) {
      video.style.removeProperty("width");
      video.style.removeProperty("height");
      video.style.removeProperty("left");
      video.style.removeProperty("top");
    }
    const container = document.querySelector(".html5-video-container");
    if (container) {
      container.style.removeProperty("width");
      container.style.removeProperty("height");
    }

    if (player) {
      if (originalPlayerStyle) {
        player.setAttribute("style", originalPlayerStyle);
      } else {
        player.removeAttribute("style");
      }

      // 원래 부모가 DOM에 연결되어 있으면 그곳으로 복원
      if (originalParent && originalParent.isConnected) {
        if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
          originalParent.insertBefore(player, originalNextSibling);
        } else {
          originalParent.appendChild(player);
        }
      } else {
        // 새로고침 후 등 원래 부모를 못 찾으면 기본 위치로 복원
        const fallback = document.querySelector('ytd-player#ytd-player #container')
            || document.querySelector('#ytd-player #container')
            || document.querySelector('#player-container #container');
        if (fallback) {
          fallback.prepend(player);
        }
      }
    }

    if (wall) wall.remove();
    document.body.style.removeProperty("overflow");
    originalParent = null;
    originalNextSibling = null;
    originalPlayerStyle = "";
    state.active = false;

    // YouTube에게 원래 크기로 되돌리라고 알림
    window.dispatchEvent(new Event("resize"));

    // re-parenting 후 영상이 멈추면 다시 재생
    if (wasPlaying && video) {
      setTimeout(() => { if (video.paused) video.play(); }, 200);
    }

    console.log("[CV] Deactivated");
  }

  // ── 테마 변경 ──
  async function updateTheme(theme) {
    state.animalTheme = theme;
    await prefetch();
    const wall = document.getElementById("cv-wall");
    if (wall) fillWall(wall);
  }

  // ── 토글 ──
  function toggle(enabled) {
    console.log("[CV] Toggle:", enabled);
    state.enabled = enabled;
    if (enabled) {
      const tryActivate = (retries = 20) => {
        if (document.querySelector("#movie_player")) activate();
        else if (retries > 0) setTimeout(() => tryActivate(retries - 1), 500);
      };
      tryActivate();
    } else {
      deactivate();
    }
  }

  // ── 초기화 ──
  chrome.storage.sync.get(["enabled", "animalTheme", "videoSize"], async (data) => {
    console.log("[CV] Storage:", JSON.stringify(data));
    if (data.animalTheme) state.animalTheme = data.animalTheme;
    if (data.videoSize) VIDEO_WIDTH = data.videoSize;
    await prefetch();
    if (data.enabled) toggle(true);
  });

  // ── 메시지 ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("[CV] Msg:", msg.action);
    switch (msg.action) {
      case "toggle":
        if (msg.enabled && state.active) deactivate();
        toggle(msg.enabled);
        sendResponse({ ok: true });
        break;
      case "setTheme":
        updateTheme(msg.theme).then(() => sendResponse({ ok: true }));
        return true;
      case "setSize":
        VIDEO_WIDTH = msg.size;
        if (state.active) {
          // 프레임 크기 실시간 업데이트
          const frame = document.getElementById("cv-frame");
          if (frame) {
            const player = document.querySelector("#movie_player");
            const playerRect = player ? player.getBoundingClientRect() : null;
            const aspect = playerRect ? (playerRect.width / playerRect.height) : (16/9);
            const fh = VIDEO_WIDTH / aspect;
            frame.style.width = VIDEO_WIDTH + "vw";
            frame.style.height = fh + "vw";
            forceVideoFill();
          }
        }
        sendResponse({ ok: true });
        break;
      case "getState":
        sendResponse({ ...state, imageCount: imageUrls.length });
        break;
    }
    return true;
  });

  // ── YouTube SPA ──
  if (window.location.hostname.includes("youtube.com")) {
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (state.enabled) { deactivate(); setTimeout(() => toggle(true), 1500); }
      }
    }).observe(document.body, { subtree: true, childList: true });
  }
})();
