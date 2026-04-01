/**
 * ScaryButCute - Netflix Content Script
 *
 * YouTube 코드(content-youtube.js)와 완전 분리.
 * Netflix 플레이어는 re-parenting 하지 않고,
 * position:fixed 스타일만 적용하여 wall 위에 띄움.
 */

(function () {
  "use strict";

  console.log("[CV-Netflix] loaded");

  let VIDEO_WIDTH = 60;

  // ═══════════════════════════════════════
  //  테마별 이미지 가져오기 (전부 로컬 번들)
  //  — content-youtube.js와 동일
  // ═══════════════════════════════════════
  const TILE_COUNT = 80;

  function localImageUrls(animal, count) {
    const urls = [];
    for (let i = 1; i <= count; i++) {
      urls.push(chrome.runtime.getURL(`images/${animal}/${i}.jpg`));
    }
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

  // Netflix 전용 상태
  let netflixPlayerEl = null;
  let originalPlayerStyles = "";

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
    console.log("[CV-Netflix] Prefetching:", state.animalTheme);
    try {
      const fetcher = THEME_FETCHERS[state.animalTheme] || THEME_FETCHERS.dog;
      imageUrls = await fetcher(TILE_COUNT);
      console.log("[CV-Netflix] Got", imageUrls.length, "urls");
    } catch (e) {
      console.log("[CV-Netflix] Prefetch error:", e.message);
      imageUrls = localImageUrls("dog", TILE_COUNT);
    }
    prefetching = false;
  }

  // ═══════════════════════════════════════
  //  Netflix 플레이어 찾기
  // ═══════════════════════════════════════
  function findNetflixPlayer() {
    return document.querySelector('.watch-video--player-view')
        || document.querySelector('[data-uia="video-canvas"]')
        || document.querySelector('.NFPlayer')
        || document.querySelector('.VideoContainer');
  }

  function getNetflixVideo() {
    const player = findNetflixPlayer();
    return player ? player.querySelector('video') : document.querySelector('video');
  }

  // ═══════════════════════════════════════
  //  벽 이미지 채우기
  // ═══════════════════════════════════════
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
  //  영상 상태 감시
  // ═══════════════════════════════════════
  let videoWatcherInterval = null;

  function getVideoSrc() {
    const video = getNetflixVideo();
    return video && video.src ? true : false;
  }

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

  // ═══════════════════════════════════════
  //  활성화 (Netflix 전용)
  //  — re-parenting 안 함, position:fixed 스타일만 적용
  // ═══════════════════════════════════════
  function activate() {
    if (state.active) return;
    netflixPlayerEl = findNetflixPlayer();
    if (!netflixPlayerEl) return;
    console.log("[CV-Netflix] Activating...", netflixPlayerEl.className);

    // 비디오 비율 감지 (기본 16:9)
    const video = getNetflixVideo();
    let aspect = 16 / 9;
    if (video && video.videoWidth && video.videoHeight) {
      aspect = video.videoWidth / video.videoHeight;
    }
    const frameHeight = VIDEO_WIDTH / aspect;

    // 원본 스타일 저장
    originalPlayerStyles = netflixPlayerEl.getAttribute("style") || "";

    // ① 벽 생성
    const wall = document.createElement("div");
    wall.id = "cv-wall";
    fillWall(wall);

    // ② Netflix 플레이어에 fixed 스타일 적용 (wall 위로 띄움)
    netflixPlayerEl.style.setProperty("position", "fixed", "important");
    netflixPlayerEl.style.setProperty("top", "50%", "important");
    netflixPlayerEl.style.setProperty("left", "50%", "important");
    netflixPlayerEl.style.setProperty("transform", "translate(-50%, -50%)", "important");
    netflixPlayerEl.style.setProperty("width", VIDEO_WIDTH + "vw", "important");
    netflixPlayerEl.style.setProperty("height", frameHeight + "vw", "important");
    netflixPlayerEl.style.setProperty("z-index", "1000001", "important");
    netflixPlayerEl.style.setProperty("border-radius", "12px", "important");
    netflixPlayerEl.style.setProperty("overflow", "hidden", "important");
    netflixPlayerEl.style.setProperty("box-shadow", "0 0 80px rgba(0,0,0,0.8)", "important");

    // ③ "영상 없음" 안내 (wall 위, 플레이어 아래)
    const noVideoMsg = document.createElement("div");
    noVideoMsg.id = "cv-no-video";
    noVideoMsg.style.cssText = `
      position: fixed;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: ${VIDEO_WIDTH}vw;
      height: ${frameHeight}vw;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      color: rgba(255,255,255,0.7);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      z-index: 1000000; pointer-events: none;
      background: rgba(0,0,0,0.85);
      border-radius: 12px;
      transition: opacity 0.3s;
    `;
    noVideoMsg.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 12px;">🐾</div>
      <div style="font-size: 18px; font-weight: 600; margin-bottom: 6px;">No video playing</div>
      <div style="font-size: 13px; color: rgba(255,255,255,0.4);">Play a Netflix video to watch in comfort mode</div>
    `;

    // ④ DOM에 추가
    document.body.appendChild(wall);
    document.body.appendChild(noVideoMsg);
    document.body.style.setProperty("overflow", "hidden", "important");

    state.active = true;
    startVideoWatcher();

    console.log("[CV-Netflix] Activated! Frame:", VIDEO_WIDTH + "vw x " + frameHeight.toFixed(2) + "vw");
  }

  // ═══════════════════════════════════════
  //  비활성화 (Netflix 전용)
  // ═══════════════════════════════════════
  function deactivate() {
    stopVideoWatcher();

    // Netflix 플레이어 스타일 복원
    if (netflixPlayerEl) {
      if (originalPlayerStyles) {
        netflixPlayerEl.setAttribute("style", originalPlayerStyles);
      } else {
        netflixPlayerEl.removeAttribute("style");
      }
    }

    // wall, no-video 메시지 제거
    const wall = document.getElementById("cv-wall");
    if (wall) wall.remove();
    const noVideo = document.getElementById("cv-no-video");
    if (noVideo) noVideo.remove();

    document.body.style.removeProperty("overflow");
    netflixPlayerEl = null;
    originalPlayerStyles = "";
    state.active = false;

    console.log("[CV-Netflix] Deactivated");
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
    console.log("[CV-Netflix] Toggle:", enabled);
    state.enabled = enabled;
    if (enabled) {
      const tryActivate = (retries = 30) => {
        if (findNetflixPlayer()) activate();
        else if (retries > 0) setTimeout(() => tryActivate(retries - 1), 500);
      };
      tryActivate();
    } else {
      deactivate();
    }
  }

  // ── 초기화 ──
  chrome.storage.sync.get(["enabled", "animalTheme", "videoSize"], (data) => {
    console.log("[CV-Netflix] Storage:", JSON.stringify(data));
    if (data.animalTheme) state.animalTheme = data.animalTheme;
    if (data.videoSize) VIDEO_WIDTH = data.videoSize;
    prefetch();
    if (data.enabled) toggle(true);
  });

  // ── 메시지 ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("[CV-Netflix] Msg:", msg.action);
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
        if (state.active && netflixPlayerEl) {
          const aspect = 16 / 9;
          const fh = VIDEO_WIDTH / aspect;
          netflixPlayerEl.style.setProperty("width", VIDEO_WIDTH + "vw", "important");
          netflixPlayerEl.style.setProperty("height", fh + "vw", "important");
          const noVideo = document.getElementById("cv-no-video");
          if (noVideo) {
            noVideo.style.width = VIDEO_WIDTH + "vw";
            noVideo.style.height = fh + "vw";
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

  // ── Netflix SPA 네비게이션 감지 ──
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (state.enabled) {
        deactivate();
        setTimeout(() => toggle(true), 2000);
      }
    }
  }).observe(document.body, { subtree: true, childList: true });
})();
