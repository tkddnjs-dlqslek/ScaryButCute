/**
 * ScaryButCute - Popup Script v7
 * 동물 테마 + 영상 크기 조절 + 단축키 힌트
 */

document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("mainToggle");
  const themeBtns = document.querySelectorAll(".theme-btn");
  const statusMsg = document.getElementById("statusMsg");
  const sizeSlider = document.getElementById("sizeSlider");
  const sizeValue = document.getElementById("sizeValue");

  // 저장된 상태 불러오기
  chrome.storage.sync.get(["enabled", "animalTheme", "videoSize"], (data) => {
    toggle.checked = data.enabled || false;
    updateStatus(toggle.checked);

    const theme = data.animalTheme || "dog";
    themeBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.theme === theme);
    });

    const size = data.videoSize || 60;
    sizeSlider.value = size;
    sizeValue.textContent = size + "%";
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
    });
  });

  // 영상 크기 조절
  sizeSlider.addEventListener("input", () => {
    const size = parseInt(sizeSlider.value);
    sizeValue.textContent = size + "%";
    chrome.storage.sync.set({ videoSize: size });
    sendToContent({ action: "setSize", size });
  });

  function updateStatus(enabled) {
    if (enabled) {
      statusMsg.textContent = "🐾 Comfort Mode is active.";
      statusMsg.className = "status active";
    } else {
      statusMsg.textContent = "Supports: YouTube · Netflix · Disney+";
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
