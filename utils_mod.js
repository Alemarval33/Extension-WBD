// utils_mod.js
// Utilidades compartidas: creación de botones, notificaciones
// y popup persistente para validar métricas capturadas.
// ❌ Removidas filas "Home" y "Away" del render genérico del popup.
//    (El popup mostrará sólo las filas inyectadas desde content_mux.js
//     con los valores provenientes de Airtable).

function createStyledButton(id, label, onClick) {
  if (document.getElementById(id)) {
    console.warn(`[Utils] Botón con ID "${id}" ya existe, no se crea duplicado.`);
    return;
  }
  const btn = document.createElement("button");
  btn.id = id;
  btn.textContent = label;

  btn.style.position = "fixed";
  btn.style.bottom = "20px";
  const existing = document.querySelectorAll(".mux-btn").length;
  btn.style.right = `${20 + existing * 130}px`;
  btn.style.zIndex = "99999";
  btn.style.background = "#1565c0";
  btn.style.color = "#fff";
  btn.style.padding = "10px 18px";
  btn.style.border = "none";
  btn.style.borderRadius = "8px";
  btn.style.fontSize = "14px";
  btn.style.fontWeight = "bold";
  btn.style.cursor = "pointer";
  btn.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
  btn.classList.add("mux-btn");

  btn.addEventListener("mouseenter", () => (btn.style.background = "#0d47a1"));
  btn.addEventListener("mouseleave", () => (btn.style.background = "#1565c0"));

  btn.addEventListener("click", onClick);
  document.body.appendChild(btn);
  console.log(`[Utils] Botón "${label}" creado correctamente.`);
}

// ------------------------------------------------------
// Popup persistente de validación de datos
// ------------------------------------------------------
function showPersistentDataPopup(data) {
  if (!data || typeof data !== "object") {
    console.warn("[Utils] showPersistentDataPopup llamado sin datos válidos.");
    return;
  }

  let popup = document.getElementById("mux-data-popup");
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "mux-data-popup";
    popup.style.position = "fixed";
    popup.style.top = "20px";
    popup.style.right = "20px";
    popup.style.background = "#1565c0";
    popup.style.color = "#fff";
    popup.style.padding = "14px 18px";
    popup.style.borderRadius = "12px";
    popup.style.fontFamily = "Arial, sans-serif";
    popup.style.fontSize = "13px";
    popup.style.fontWeight = "600";
    popup.style.boxShadow = "0 6px 18px rgba(0,0,0,0.28)";
    popup.style.zIndex = "99999";
    popup.style.maxWidth = "320px";
    popup.style.lineHeight = "1.35em";
    popup.style.userSelect = "text";
    popup.style.cursor = "move";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.gap = "8px";
    header.style.marginBottom = "8px";

    const title = document.createElement("div");
    title.textContent = "📊 Datos MUX (preview)";
    title.style.fontSize = "15px";
    title.style.fontWeight = "800";

    const btns = document.createElement("div");
    btns.style.display = "flex";
    btns.style.gap = "8px";

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copiar JSON";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Cerrar";

    [copyBtn, closeBtn].forEach((b) => {
      b.style.background = "#0d47a1";
      b.style.color = "#fff";
      b.style.border = "none";
      b.style.borderRadius = "8px";
      b.style.padding = "6px 10px";
      b.style.fontSize = "12px";
      b.style.fontWeight = "700";
      b.style.cursor = "pointer";
      b.onmouseenter = () => (b.style.background = "#093270");
      b.onmouseleave = () => (b.style.background = "#0d47a1");
    });

    copyBtn.onclick = () => {
      const json = JSON.stringify(data, null, 2);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(json).then(
          () => showFloatingMessage("JSON copiado", true),
          () => showFloatingMessage("No se pudo copiar", false)
        );
      } else {
        const ta = document.createElement("textarea");
        ta.value = json;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); showFloatingMessage("JSON copiado", true); }
        catch { showFloatingMessage("No se pudo copiar", false); }
        document.body.removeChild(ta);
      }
    };
    closeBtn.onclick = () => popup.remove();

    btns.appendChild(copyBtn);
    btns.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(btns);

    const content = document.createElement("div");
    content.id = "mux-data-popup-content";
    content.style.display = "grid";
    content.style.rowGap = "4px";

    const footer = document.createElement("div");
    footer.id = "mux-data-popup-footer";
    footer.style.marginTop = "8px";
    footer.style.fontSize = "12px";
    footer.style.opacity = ".9";

    popup.appendChild(header);
    popup.appendChild(content);
    popup.appendChild(footer);
    document.body.appendChild(popup);

    makeDraggable(popup, header);
  }

  // ✅ Render SIN “Home”/“Away” genéricos (se inyectan desde content_mux.js los de Airtable)
  const c = document.getElementById("mux-data-popup-content");
  const f = document.getElementById("mux-data-popup-footer");

  c.innerHTML = `
    <div>👁️ <b>Views:</b> ${safe(data.views)}</div>
    <div>🧑‍🤝‍🧑 <b>Unique Viewers:</b> ${safe(data.unique_viewers)}</div>
    <div>⚠️ <b>Playback Failure Percentage:</b> ${safe(data.playback_failure_percentage)}</div>
    <div>⏩ <b>Video Startup Failure Percentage:</b> ${safe(data.video_startup_failure_percentage)}</div>
  `;

  const dashUrl = data.mux_dashboard_url || data.dashboard_url || data.url || "";
  f.textContent = dashUrl ? `🔗 Dashboard: ${dashUrl}` : "";
}

function safe(v) { return v == null || v === "" ? "-" : v; }

function makeDraggable(el, handle) {
  let offX = 0, offY = 0, dragging = false;
  const down = (e) => {
    dragging = true;
    const rect = el.getBoundingClientRect();
    offX = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    offY = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
    e.preventDefault();
  };
  const move = (e) => {
    if (!dragging) return;
    const x = (e.clientX || e.touches?.[0]?.clientX) - offX;
    const y = (e.clientY || e.touches?.[0]?.clientY) - offY;
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    el.style.right = "auto"; el.style.bottom = "auto";
  };
  const up = () => (dragging = false);

  (handle || el).addEventListener("mousedown", down);
  (handle || el).addEventListener("touchstart", down, { passive: false });
  window.addEventListener("mousemove", move);
  window.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("mouseup", up);
  window.addEventListener("touchend", up);
}

// ------------------------------------------------------
// Mensaje flotante
// ------------------------------------------------------
function showFloatingMessage(message, success = true) {
  let msg = document.getElementById("mux-floating-msg");
  if (!msg) {
    msg = document.createElement("div");
    msg.id = "mux-floating-msg";
    msg.style.position = "fixed";
    msg.style.bottom = "80px";
    msg.style.right = "20px";
    msg.style.zIndex = "999999";
    msg.style.padding = "10px 18px";
    msg.style.borderRadius = "8px";
    msg.style.color = "#fff";
    msg.style.fontSize = "14px";
    msg.style.fontWeight = "bold";
    msg.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
    msg.style.transition = "opacity 0.3s ease-in-out";
    document.body.appendChild(msg);
  }
  msg.textContent = message;
  msg.style.background = success ? "#4CAF50" : "#e53935";
  msg.style.opacity = "1";
  setTimeout(() => (msg.style.opacity = "0"), 3000);
}

// ------------------------------------------------------
// Logger
// ------------------------------------------------------
function logDebug(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}
