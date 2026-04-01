/**
 * ScaryButCute - Background Service Worker
 * Alt+C 단축키 처리
 */

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-comfort") {
    chrome.storage.sync.get(["enabled"], (data) => {
      const newEnabled = !data.enabled;
      chrome.storage.sync.set({ enabled: newEnabled });

      // 현재 활성 탭에 메시지 전송
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "toggle",
            enabled: newEnabled,
          }).catch(() => {});
        }
      });
    });
  }
});
