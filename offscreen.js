(() => {
  "use strict";

  const REPEAT_COUNT = 3;
  const REPEAT_GAP_MS = 900;

  function play() {
    const audio = document.getElementById("alert");
    if (!audio) return;
    let played = 0;
    const start = () => {
      audio.currentTime = 0;
      const result = audio.play();
      result?.catch?.(() => {});
      played += 1;
      if (played < REPEAT_COUNT) window.setTimeout(start, REPEAT_GAP_MS);
    };
    start();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.target !== "offscreen" || message?.type !== "studylog-bridge:play-alert") return;
    play();
  });
})();
