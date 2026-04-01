/**
 * ScaryButCute - Disney+ Content Script
 *
 * YouTube 코드(content-youtube.js)와 완전 분리.
 * Disney+ 플레이어는 re-parenting 하지 않고,
 * position:fixed 스타일만 적용하여 wall 위에 띄움.
 */

(function () {
  "use strict";

  console.log("[CV-Disney] loaded");

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

  // Disney+ 전용 상태
  let videoEl = null;
  let originalVideoParent = null;
  let originalVideoNextSibling = null;
  let originalVideoStyles = "";
  let controlsEl = null;

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
    console.log("[CV-Disney] Prefetching:", state.animalTheme);
    try {
      const fetcher = THEME_FETCHERS[state.animalTheme] || THEME_FETCHERS.dog;
      imageUrls = await fetcher(TILE_COUNT);
      console.log("[CV-Disney] Got", imageUrls.length, "urls");
    } catch (e) {
      console.log("[CV-Disney] Prefetch error:", e.message);
      imageUrls = localImageUrls("dog", TILE_COUNT);
    }
    prefetching = false;
  }

  // ═══════════════════════════════════════
  //  Netflix 플레이어 찾기
  // ═══════════════════════════════════════
  function findDisneyPlayer() {
    // 재생 중인 video를 찾아서 가장 가까운 적절한 부모를 반환
    const video = [...document.querySelectorAll('video')].find(v => v.readyState > 0 || v.currentTime > 0);
    if (video) return video.parentElement;
    return document.querySelector('.media-element-container')
        || document.querySelector('.btm-media-client');
  }

  function getDisneyVideo() {
    const player = findDisneyPlayer();
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
    // Disney+는 video가 2개 — 재생 중인 걸 찾아야 함
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      if (v.readyState > 0 || v.currentTime > 0 || v.src) return true;
    }
    return false;
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

    // 재생 중인 video 찾기
    videoEl = [...document.querySelectorAll('video')].find(v => v.readyState > 0 || v.currentTime > 0);
    if (!videoEl) return;
    console.log("[CV-Disney] Activating... video found");

    // 비디오 비율 감지 (기본 16:9)
    let aspect = 16 / 9;
    if (videoEl.videoWidth && videoEl.videoHeight) {
      aspect = videoEl.videoWidth / videoEl.videoHeight;
    }
    const frameHeight = VIDEO_WIDTH / aspect;

    // 원본 위치/스타일 저장
    originalVideoParent = videoEl.parentElement;
    originalVideoNextSibling = videoEl.nextSibling;
    originalVideoStyles = videoEl.getAttribute("style") || "";

    // ① 벽 생성
    const wall = document.createElement("div");
    wall.id = "cv-wall";
    fillWall(wall);

    // ② 프레임 생성
    const frame = document.createElement("div");
    frame.id = "cv-frame";
    frame.style.cssText = `
      position: fixed;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: ${VIDEO_WIDTH}vw;
      height: ${frameHeight}vw;
      z-index: 1000000;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 0 80px rgba(0,0,0,0.8);
      background: #000;
    `;

    // ③ video를 프레임으로 re-parenting
    frame.appendChild(videoEl);
    videoEl.style.cssText = 'width:100% !important; height:100% !important; object-fit:contain !important;';

    // ④ 자체 미니 컨트롤바
    const controls = document.createElement("div");
    controls.id = "cv-controls";
    controls.style.cssText = `
      position: absolute; bottom: 0; left: 0; right: 0;
      height: 48px; background: linear-gradient(transparent, rgba(0,0,0,0.85));
      display: flex; align-items: center; padding: 0 16px; gap: 12px;
      z-index: 10; opacity: 0; transition: opacity 0.3s;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: white; font-size: 13px;
    `;

    // 재생/정지 버튼
    const playBtn = document.createElement("button");
    playBtn.id = "cv-play-btn";
    playBtn.textContent = "⏸";
    playBtn.style.cssText = 'background:none; border:none; color:white; font-size:20px; cursor:pointer; padding:4px 8px;';
    playBtn.addEventListener('click', () => {
      if (videoEl.paused) videoEl.play(); else videoEl.pause();
    });

    // 시간 표시 (숨김 — re-parenting 시 리셋 문제)
    const timeDisplay = document.createElement("span");
    timeDisplay.style.display = 'none';

    // 프로그레스바
    const progressWrap = document.createElement("div");
    progressWrap.style.cssText = 'flex:1; height:6px; background:rgba(255,255,255,0.3); border-radius:3px; cursor:pointer; position:relative;';
    const progressBar = document.createElement("div");
    progressBar.id = "cv-progress";
    progressBar.style.cssText = 'height:100%; background:#ff6b6b; border-radius:3px; width:0%; pointer-events:none;';
    progressWrap.appendChild(progressBar);
    progressWrap.addEventListener('click', (e) => {
      const rect = progressWrap.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      videoEl.currentTime = ratio * videoEl.duration;
    });

    // 볼륨
    const volBtn = document.createElement("button");
    volBtn.textContent = "🔊";
    volBtn.style.cssText = 'background:none; border:none; color:white; font-size:16px; cursor:pointer; padding:4px;';
    const volSlider = document.createElement("input");
    volSlider.type = "range";
    volSlider.min = "0";
    volSlider.max = "1";
    volSlider.step = "0.05";
    volSlider.value = "1";
    volSlider.style.cssText = 'width:60px; cursor:pointer; accent-color:#ff6b6b;';
    volSlider.addEventListener('input', () => {
      videoEl.volume = parseFloat(volSlider.value);
      volBtn.textContent = videoEl.volume === 0 ? "🔇" : videoEl.volume < 0.5 ? "🔉" : "🔊";
    });
    volBtn.addEventListener('click', () => {
      videoEl.muted = !videoEl.muted;
      volBtn.textContent = videoEl.muted ? "🔇" : "🔊";
    });

    controls.append(playBtn, volBtn, volSlider);
    frame.appendChild(controls);

    // 재생 상태 업데이트 타이머
    const controlTimer = setInterval(() => {
      if (!videoEl || !document.getElementById("cv-controls")) {
        clearInterval(controlTimer);
        return;
      }
      playBtn.textContent = videoEl.paused ? "▶" : "⏸";
    }, 500);

    // 마우스 호버 시 컨트롤 표시
    frame.addEventListener('mouseenter', () => { controls.style.opacity = '1'; });
    frame.addEventListener('mouseleave', () => { controls.style.opacity = '0'; });

    // 영상 클릭 재생/정지
    videoEl.addEventListener('click', () => {
      if (videoEl.paused) videoEl.play(); else videoEl.pause();
    });
    videoEl.style.cursor = 'pointer';

    // ⑤ DOM에 추가
    wall.appendChild(frame);
    document.body.appendChild(wall);
    document.body.style.setProperty("overflow", "hidden", "important");

    state.active = true;
    startVideoWatcher();

    console.log("[CV-Disney] Activated! Frame:", VIDEO_WIDTH + "vw x " + frameHeight.toFixed(2) + "vw");
  }

  // ═══════════════════════════════════════
  //  비활성화 (Netflix 전용)
  // ═══════════════════════════════════════
  function deactivate() {
    stopVideoWatcher();


    // video를 원래 위치로 복원
    if (videoEl && originalVideoParent) {
      if (originalVideoStyles) {
        videoEl.setAttribute("style", originalVideoStyles);
      } else {
        videoEl.removeAttribute("style");
      }
      if (originalVideoNextSibling && originalVideoNextSibling.parentNode === originalVideoParent) {
        originalVideoParent.insertBefore(videoEl, originalVideoNextSibling);
      } else {
        originalVideoParent.appendChild(videoEl);
      }
    }

    // wall 제거
    const wall = document.getElementById("cv-wall");
    if (wall) wall.remove();

    document.body.style.removeProperty("overflow");
    videoEl = null;
    originalVideoParent = null;
    originalVideoNextSibling = null;
    originalVideoStyles = "";
    controlsEl = null;
    state.active = false;

    console.log("[CV-Disney] Deactivated");
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
    console.log("[CV-Disney] Toggle:", enabled);
    state.enabled = enabled;
    if (enabled) {
      const tryActivate = (retries = 30) => {
        if (findDisneyPlayer()) activate();
        else if (retries > 0) setTimeout(() => tryActivate(retries - 1), 500);
      };
      tryActivate();
    } else {
      deactivate();
    }
  }

  // ── 초기화 ──
  chrome.storage.sync.get(["enabled", "animalTheme", "videoSize"], (data) => {
    console.log("[CV-Disney] Storage:", JSON.stringify(data));
    if (data.animalTheme) state.animalTheme = data.animalTheme;
    if (data.videoSize) VIDEO_WIDTH = data.videoSize;
    prefetch();
    if (data.enabled) toggle(true);
  });

  // ── 메시지 ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("[CV-Disney] Msg:", msg.action);
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
          const frame = document.getElementById("cv-frame");
          if (frame) {
            const aspect = 16 / 9;
            const fh = VIDEO_WIDTH / aspect;
            frame.style.width = VIDEO_WIDTH + "vw";
            frame.style.height = fh + "vw";
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
