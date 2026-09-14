(() => {
  "use strict";
  const card = document.getElementById("card");
  const icon = document.getElementById("icon");
  const title = document.getElementById("title");
  const subtitle = document.getElementById("subtitle");

  window.electronAPI.onAlertUpdate((data) => {
    title.textContent = data.title || "자세 코치";
    subtitle.textContent = data.subtitle || "";
    card.classList.toggle("notice", !!data.notice);
    icon.textContent = data.notice ? "○" : "!";
    card.classList.add("visible");
  });
})();
