/**
 * Comfort Viewer - Content Script v14
 *
 * v13 → v14 변경:
 * - 성능 대폭 개선: 타일 100→48, API 호출 최소화
 * - cataas.com → placekitten.com (즉시 로딩)
 * - loremflickr.com 제거, 토끼도 some-random-api 사용
 * - DocumentFragment로 DOM 일괄 삽입
 * - 백그라운드 프리워밍 (인기 테마 자동 프리페치)
 * - 테마 캐시 유지
 */

(function () {
  "use strict";

  console.log("[CV] v14 loaded");

  const VIDEO_WIDTH = 60;
  const TILE_COUNT = 48; // 100 → 48 (6×8 그리드 정도)

  // ═══════════════════════════════════════
  //  some-random-api.com 헬퍼
  // ═══════════════════════════════════════
  async function fetchRandomApi(animal, count) {
    // 8개만 병렬 요청 → 나머지는 반복 사용
    const batchSize = Math.min(count, 8);
    const promises = [];
    for (let i = 0; i < batchSize; i++) {
      promises.push(
        fetch(`https://some-random-api.com/animal/${animal}`)
          .then(r => r.json())
          .then(d => d.image)
          .catch(() => null)
      );
    }
    const results = await Promise.all(promises);
    const unique = results.filter(Boolean);
    if (unique.length === 0) return [];
    // 반복해서 count 채우기
    const urls = [];
    for (let i = 0; i < count; i++) {
      urls.push(unique[i % unique.length]);
    }
    return urls;
  }

  // ═══════════════════════════════════════
  //  테마별 이미지 가져오기
  // ═══════════════════════════════════════
  const THEME_FETCHERS = {
    dog: async (count) => {
      const res = await fetch(`https://dog.ceo/api/breeds/image/random/${Math.min(count, 50)}`);
      const data = await res.json();
      const urls = data.message || [];
      while (urls.length < count && urls.length > 0) urls.push(urls[urls.length % urls.length]);
      return urls.slice(0, count);
    },
    cat: async (count) => {
      // placekitten: 즉시 로딩, 크기만 다르게
      const sizes = [
        [150,100],[160,110],[140,105],[155,95],[145,100],
        [150,110],[160,100],[140,95],[155,105],[145,110],
        [148,98],[152,102],[158,108],[142,92],[156,96],
        [144,104],[150,106],[160,94],[138,100],[162,100],
      ];
      const urls = [];
      for (let i = 0; i < count; i++) {
        const [w, h] = sizes[i % sizes.length];
        urls.push(`https://placekitten.com/${w}/${h}`);
      }
      return urls;
    },
    cat_gif: async (count) => {
      const base = Date.now();
      const gifCount = Math.min(count, 20);
      const urls = [];
      for (let i = 0; i < gifCount; i++) {
        urls.push(`https://cataas.com/cat/gif?t=${base}_${i}`);
      }
      while (urls.length < count) urls.push(urls[urls.length % gifCount]);
      return urls;
    },
    koala: async (count) => fetchRandomApi("koala", count),
    rabbit: async (count) => fetchRandomApi("rabbit", count),
    panda: async (count) => fetchRandomApi("panda", count),
    fox: async (count) => {
      // randomfox.ca: 정적 파일, 즉시 로딩 (1~123)
      const urls = [];
      const used = new Set();
      const max = Math.min(count, 123);
      for (let i = 0; i < max; i++) {
        let n;
        do { n = Math.floor(Math.random() * 123) + 1; } while (used.has(n));
        used.add(n);
        urls.push(`https://randomfox.ca/images/${n}.jpg`);
      }
      while (urls.length < count) urls.push(urls[urls.length % max]);
      return urls;
    },
    bird: async (count) => fetchRandomApi("bird", count),
    raccoon: async (count) => fetchRandomApi("raccoon", count),
    red_panda: async (count) => fetchRandomApi("red_panda", count),
    kangaroo: async (count) => fetchRandomApi("kangaroo", count),
    whale: async (count) => fetchRandomApi("whale", count),
    mixed: async (count) => {
      const q = Math.ceil(count / 4);
      const [dogs, cats, foxes, pandas] = await Promise.all([
        THEME_FETCHERS.dog(q),
        THEME_FETCHERS.cat(q),
        THEME_FETCHERS.fox(q),
        THEME_FETCHERS.panda(q),
      ]);
      const all = [];
      const sources = [dogs, cats, foxes, pandas];
      for (let i = 0; i < count; i++) {
        const src = sources[i % sources.length];
        if (src.length > 0) all.push(src.shift());
      }
      return all;
    },
  };

  let state = { enabled: false, animalTheme: "dog", gifMode: false, active: false };
  let imageUrls = [];
  let prefetching = false;
  const imageCache = {};
  let originalParent = null;
  let originalNextSibling = null;
  let originalPlayerStyle = "";
  let videoObserver = null;
  let videoForceInterval = null;

  function randomPastel() {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h}, 70%, 85%)`;
  }

  // ═══════════════════════════════════════
  //  프리페치 (캐시 지원)
  // ═══════════════════════════════════════
  async function prefetch(forceRefresh = false) {
    if (prefetching) return;
    const theme = state.animalTheme;
    const useGif = state.gifMode && theme === "cat";
    const fetchKey = useGif ? "cat_gif" : theme;

    // 캐시 히트
    if (!forceRefresh && imageCache[fetchKey] && imageCache[fetchKey].length > 0) {
      imageUrls = imageCache[fetchKey];
      console.log("[CV] Cache hit:", fetchKey, imageUrls.length);
      return;
    }

    prefetching = true;
    const t0 = performance.now();
    console.log("[CV] Fetching:", fetchKey);
    try {
      const fetcher = THEME_FETCHERS[fetchKey] || THEME_FETCHERS.dog;
      imageUrls = await fetcher(TILE_COUNT);
      imageCache[fetchKey] = imageUrls;
      console.log("[CV] Got", imageUrls.length, "urls in", Math.round(performance.now() - t0), "ms");
      // 브라우저 이미지 캐시 프리로드
      imageUrls.forEach(u => { const img = new Image(); img.src = u; });
    } catch (e) {
      console.warn("[CV] Prefetch error:", e.message);
      try {
        const res = await fetch("https://dog.ceo/api/breeds/image/random/30");
        const data = await res.json();
        imageUrls = data.message || [];
      } catch (_) { imageUrls = []; }
    }
    prefetching = false;
  }

  // 백그라운드 프리워밍: 첫 로드 후 빠른 테마들 미리 캐시
  async function prewarmCache() {
    const fastThemes = ["dog", "cat", "fox"]; // 네트워크 요청 적은 테마
    for (const t of fastThemes) {
      if (imageCache[t]) continue;
      try {
        const fetcher = THEME_FETCHERS[t];
        const urls = await fetcher(TILE_COUNT);
        imageCache[t] = urls;
        urls.forEach(u => { const img = new Image(); img.src = u; });
        console.log("[CV] Prewarmed:", t);
      } catch (_) {}
    }
  }

  // ═══════════════════════════════════════
  //  영상 감지
  // ═══════════════════════════════════════
  function getVideoSrc() {
    const video = document.querySelector("#movie_player video");
    return video && video.src ? true : false;
  }

  // ═══════════════════════════════════════
  //  video 엘리먼트 크기 강제
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
    const video = document.querySelector("#movie_player video");
    if (video) {
      videoObserver = new MutationObserver(() => forceVideoFill());
      videoObserver.observe(video, { attributes: true, attributeFilter: ["style"] });
    }
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

    const playerRect = player.getBoundingClientRect();
    const playerAspect = playerRect.width / playerRect.height;

    originalParent = player.parentNode;
    originalNextSibling = player.nextSibling;
    originalPlayerStyle = player.getAttribute("style") || "";

    const wall = document.createElement("div");
    wall.id = "cv-wall";
    fillWall(wall);

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

    frame.appendChild(player);
    player.style.setProperty("width", "100%", "important");
    player.style.setProperty("height", "100%", "important");
    player.style.setProperty("position", "relative", "important");

    wall.appendChild(frame);
    document.body.appendChild(wall);
    document.body.style.setProperty("overflow", "hidden", "important");

    state.active = true;

    window.dispatchEvent(new Event("resize"));
    startVideoForcer();
    startVideoWatcher();

    console.log("[CV] Activated!");
  }

  // ── 영상 상태 감시 ──
  let videoWatcherInterval = null;
  function startVideoWatcher() {
    stopVideoWatcher();
    updateNoVideoVisibility();
    videoWatcherInterval = setInterval(updateNoVideoVisibility, 1000);
  }
  function stopVideoWatcher() {
    if (videoWatcherInterval) { clearInterval(videoWatcherInterval); videoWatcherInterval = null; }
  }
  function updateNoVideoVisibility() {
    const msg = document.getElementById("cv-no-video");
    if (!msg) return;
    const hasVideo = getVideoSrc();
    msg.style.opacity = hasVideo ? "0" : "1";
    msg.style.pointerEvents = hasVideo ? "none" : "auto";
  }

  // ── 벽 이미지 채우기 (DocumentFragment 사용) ──
  function fillWall(wall) {
    wall.querySelectorAll(".cv-tile").forEach(t => t.remove());
    const urls = imageUrls.length > 0 ? imageUrls : [];
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < TILE_COUNT; i++) {
      const tile = document.createElement("div");
      tile.className = "cv-tile";
      tile.style.background = randomPastel();

      if (urls.length > 0) {
        const url = urls[i % urls.length];
        const img = document.createElement("img");
        img.src = url;
        img.loading = "lazy"; // 브라우저 네이티브 레이지 로딩
        img.alt = "";
        img.draggable = false;
        img.style.opacity = "0";
        img.style.transition = "opacity 0.3s";
        img.onload = () => { img.style.opacity = "1"; };
        img.onerror = () => {};
        tile.appendChild(img);
      }

      fragment.appendChild(tile);
    }

    wall.appendChild(fragment);
  }

  // ═══════════════════════════════════════
  //  비활성화
  // ═══════════════════════════════════════
  function deactivate() {
    stopVideoWatcher();
    stopVideoForcer();

    const wall = document.getElementById("cv-wall");
    const player = document.querySelector("#movie_player");

    const video = document.querySelector("#movie_player video");
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

    if (player && originalParent) {
      if (originalPlayerStyle) {
        player.setAttribute("style", originalPlayerStyle);
      } else {
        player.removeAttribute("style");
      }
      if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
        originalParent.insertBefore(player, originalNextSibling);
      } else {
        originalParent.appendChild(player);
      }
    }

    if (wall) wall.remove();
    document.body.style.removeProperty("overflow");
    originalParent = null;
    originalNextSibling = null;
    originalPlayerStyle = "";
    state.active = false;

    window.dispatchEvent(new Event("resize"));
    console.log("[CV] Deactivated");
  }

  // ── 테마 변경 ──
  async function updateTheme(theme) {
    state.animalTheme = theme;
    await prefetch();
    const wall = document.getElementById("cv-wall");
    if (wall) fillWall(wall);
  }

  // ── GIF 모드 변경 ──
  async function updateGifMode(gifMode) {
    state.gifMode = gifMode;
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
  chrome.storage.sync.get(["enabled", "animalTheme", "gifMode"], (data) => {
    console.log("[CV] Storage:", JSON.stringify(data));
    if (data.animalTheme) state.animalTheme = data.animalTheme;
    if (data.gifMode) state.gifMode = data.gifMode;
    prefetch().then(() => {
      if (data.enabled) toggle(true);
      // 첫 로드 후 인기 테마 백그라운드 프리워밍
      setTimeout(prewarmCache, 2000);
    });
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
      case "setGifMode":
        updateGifMode(msg.gifMode).then(() => sendResponse({ ok: true }));
        return true;
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
