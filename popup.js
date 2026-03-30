/**
 * Comfort Viewer - Popup Script v6
 * 새 동물 테마 + GIF 토글 + 단축키 힌트
 */

document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("mainToggle");
  const gifToggle = document.getElementById("gifToggle");
  const themeBtns = document.querySelectorAll(".theme-btn");
  const statusMsg = document.getElementById("statusMsg");
  const gifSection = document.getElementById("gifSection");

  // 저장된 상태 불러오기
  chrome.storage.sync.get(["enabled", "animalTheme", "gifMode"], (data) => {
    toggle.checked = data.enabled || false;
    updateStatus(toggle.checked);

    const theme = data.animalTheme || "koala";
    themeBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.theme === theme);
    });

    // GIF 모드 복원
    gifToggle.checked = data.gifMode || false;
    updateGifSectionVisibility(theme);
  });

  // 메인 토글
  toggle.addEventListener("change", () => {
    const enabled = toggle.checked;
    chrome.storage.sync.set({ enabled });
    updateStatus(enabled);
    sendToContent({ action: "toggle", enabled });
  });

  // 테마 선택
  themeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      themeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const theme = btn.dataset.theme;
      chrome.storage.sync.set({ animalTheme: theme });
      sendToContent({ action: "setTheme", theme });
      updateGifSectionVisibility(theme);
    });
  });

  // GIF 토글
  gifToggle.addEventListener("change", () => {
    const gifMode = gifToggle.checked;
    chrome.storage.sync.set({ gifMode });
    sendToContent({ action: "setGifMode", gifMode });
  });

  // GIF 섹션은 고양이 테마일 때만 강조 (항상 보이되, 비활성 시 흐리게)
  function updateGifSectionVisibility(theme) {
    if (theme === "cat") {
      gifSection.style.opacity = "1";
      gifSection.style.pointerEvents = "auto";
    } else {
      gifSection.style.opacity = "0.4";
      gifSection.style.pointerEvents = "none";
    }
  }

  function updateStatus(enabled) {
    if (enabled) {
      statusMsg.textContent = "🐾 컴포트 모드 활성화 중!";
      statusMsg.className = "status active";
    } else {
      statusMsg.textContent = "지원: YouTube · Netflix · TVING · Wavve · Coupang Play";
      statusMsg.className = "status";
    }
  }

  function sendToContent(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
      }
    });
  }
});
