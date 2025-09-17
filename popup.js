// popup.js — MUX Data Helper (MV3)
// Abre Monitoring y Overview (Data) para un video_id.
// Overview ahora se abre filtrado al rango temporal exacto del evento.

document.addEventListener("DOMContentLoaded", () => {
  console.log("[MUX Helper] popup.js cargado");

  const videoIdInput       = document.getElementById("videoId");
  const saveBtn            = document.getElementById("guardarId");
  const abrirMonitoringBtn = document.getElementById("abrirMonitoring");
  const abrirOverviewBtn   = document.getElementById("abrirOverview");
  const msgvid             = document.getElementById("msgvid");

  // ✅ Cargar Video ID guardado
  chrome.storage.local.get(["muxVideoId"], (data) => {
    if (data.muxVideoId) videoIdInput.value = data.muxVideoId;
  });

  // ✅ Guardar Video ID
  saveBtn.addEventListener("click", () => {
    const videoId = videoIdInput.value.trim();
    if (!videoId) {
      showMessage("❌ Ingrese un Video ID.", false);
      return;
    }
    chrome.storage.local.set({ muxVideoId: videoId }, () => {
      console.log("[MUX Helper] Video ID guardado:", videoId);
      showMessage("✔️ Video ID guardado!", true);
    });
  });

  // ✅ Abrir solo Monitoreo (sin cambios en rango de tiempo)
  abrirMonitoringBtn.addEventListener("click", () => {
    chrome.storage.local.get(["muxVideoId"], (data) => {
      const vid = data.muxVideoId;
      if (!vid) return showMessage("❌ Ingrese un Video ID.", false);
      openMonitoring(vid);
    });
  });

  // ✅ Abrir Overview + Informes (Overview filtrado por rango del evento)
  abrirOverviewBtn.addEventListener("click", () => {
    chrome.storage.local.get(["muxVideoId"], (data) => {
      const vid = data.muxVideoId;
      if (!vid) return showMessage("❌ Ingrese un Video ID.", false);
      openOverviewAndInformesWithEventRange(vid);
    });
  });

  // ======================== FUNCIONES AUXILIARES ========================
  
  // ✅ Obtener rango temporal desde el sheet (columnas M y O)
  async function getEventTimeRangeFromSheet(videoId) {
    try {
      console.log("[MUX Helper] 🔍 Buscando video_id en sheet:", videoId);
      const appsScriptUrl = "https://script.google.com/macros/s/AKfycbxzkAGE805YTk7LAYm5Kbby9rdeFZ5xpz2AXS808rsKP4PaVk3QcWN1BDVF2mg59tth/exec";
      
      // Solicitar datos específicos del video_id
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: "getFromSheet",
          url: `${appsScriptUrl}?action=get_event_range&video_id=${encodeURIComponent(videoId)}`
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        });
      });

      console.log("[MUX Helper] 📝 Respuesta completa del sheet:", JSON.stringify(response, null, 2));

      if (response && response.ok) {
        console.log("[MUX Helper] ✅ Respuesta exitosa del sheet");
        console.log("[MUX Helper] 📅 startTime (columna M):", response.startTime, "Tipo:", typeof response.startTime);
        console.log("[MUX Helper] 📅 endTime (columna O):", response.endTime, "Tipo:", typeof response.endTime);
        
        if (response.startTime && response.endTime) {
          console.log("[MUX Helper] ✅ Ambas fechas encontradas, procesando...");
          return {
            startTime: response.startTime,
            endTime: response.endTime,
            found: true
          };
        } else {
          console.warn("[MUX Helper] ⚠️ Una o ambas fechas están vacías");
          console.log("[MUX Helper] startTime existe:", !!response.startTime);
          console.log("[MUX Helper] endTime existe:", !!response.endTime);
        }
      } else {
        console.warn("[MUX Helper] ❌ Respuesta no exitosa del sheet");
        console.log("[MUX Helper] response.ok:", response?.ok);
        console.log("[MUX Helper] response.error:", response?.error);
      }
      
      console.log("[MUX Helper] 🔄 Retornando found: false");
      return { found: false };
    } catch (error) {
      console.error("[MUX Helper] ❌ Error getting event range:", error);
      return { found: false };
    }
  }

  // ✅ Convertir timestamp a formato requerido por Mux (Unix timestamp en segundos)
  function formatTimeForMux(timestamp) {
    try {
      console.log("[MUX Helper] 🔄 Formateando timestamp:", timestamp, "Tipo:", typeof timestamp);
      
      const date = new Date(timestamp);
      console.log("[MUX Helper] 📅 Date objeto creado:", date);
      console.log("[MUX Helper] 📅 Date válido?", !isNaN(date.getTime()));
      
      if (isNaN(date.getTime())) {
        console.warn("[MUX Helper] ❌ Invalid date:", timestamp);
        return null;
      }
      
      // Convertir a Unix timestamp en segundos (no milisegundos)
      const unixTimestamp = Math.floor(date.getTime() / 1000);
      console.log("[MUX Helper] 🎯 Unix timestamp generado:", unixTimestamp);
      return unixTimestamp;
    } catch (error) {
      console.error("[MUX Helper] ❌ Error formatting time:", error);
      return null;
    }
  }

  function openMonitoring(videoId) {
    const org = "g4m6v6", env = "4l0u8v";
    const monitoringUrl =
      `https://dashboard.mux.com/organizations/${org}/environments/${env}` +
      `/monitoring?filters%5B0%5D=video_id%3A${encodeURIComponent(videoId)}`;

    chrome.tabs.create({ url: monitoringUrl, active: true }, () => {
      console.log("[MUX Helper] Pestaña Monitoring abierta");
    });
    showMessage("✔️ Abriendo Monitoring...", true);
  }

  async function openOverviewAndInformesWithEventRange(videoId) {
    console.log("[MUX Helper] 🚀 Iniciando openOverviewAndInformesWithEventRange para video:", videoId);
    showMessage("🔍 Consultando rango del evento...", true);
    
    try {
      // Obtener rango temporal del sheet
      console.log("[MUX Helper] 📞 Llamando a getEventTimeRangeFromSheet...");
      const eventRange = await getEventTimeRangeFromSheet(videoId);
      console.log("[MUX Helper] 📋 eventRange recibido:", eventRange);
      
      if (eventRange.found) {
        console.log("[MUX Helper] ✅ Video encontrado, procesando fechas...");
        const startFormatted = formatTimeForMux(eventRange.startTime);
        const endFormatted = formatTimeForMux(eventRange.endTime);
        
        console.log("[MUX Helper] 🔢 startFormatted:", startFormatted);
        console.log("[MUX Helper] 🔢 endFormatted:", endFormatted);
        
        if (startFormatted && endFormatted) {
          console.log("[MUX Helper] ✅ Ambos timestamps formateados correctamente, construyendo URL...");
          // Construir URL con el rango temporal usando Unix timestamps
          const org = "g4m6v6", env = "4l0u8v";
          const base = `https://dashboard.mux.com/organizations/${org}/environments/${env}/data`;
          const params = new URLSearchParams();
          params.set("filters[0]", `video_id:${videoId}`);
          params.set("timeframe[0]", startFormatted.toString());
          params.set("timeframe[1]", endFormatted.toString());
          const dataUrl = `${base}?${params.toString()}`;

          console.log("[MUX Helper] 🎯 URL final construida:", dataUrl);

          const informesUrl = "https://wbdottolive.com/admin/global-new-report";

          chrome.tabs.create({ url: dataUrl, active: true }, (tab1) => {
            chrome.tabs.create({ url: informesUrl, active: false }, (tab2) => {
              if (tab1 && tab2) {
                chrome.runtime.sendMessage({ action: "groupTabs", tabIds: [tab1.id, tab2.id] });
              }
            });
          });

          showMessage("✔️ Abriendo Overview (rango del evento) + Informes...", true);
          console.log("[MUX Helper] Overview URL:", dataUrl);
          console.log("[MUX Helper] Using event range:", startFormatted, "to", endFormatted);
          return;
        } else {
          // Error en el formato de fechas
          console.warn("[MUX Helper] ❌ Error al formatear fechas, usando fallback 24h");
          console.log("[MUX Helper] startFormatted:", startFormatted, "endFormatted:", endFormatted);
        }
      } else {
        // Video no encontrado en el sheet
        console.log("[MUX Helper] ⚠️ Video no encontrado en sheet, usando fallback 24h");
      }

      console.log("[MUX Helper] 🔄 Ejecutando fallback a 24 horas...");
      // Fallback a 24 horas
      const org = "g4m6v6", env = "4l0u8v";
      const base = `https://dashboard.mux.com/organizations/${org}/environments/${env}/data`;
      const params = new URLSearchParams();
      params.set("filters[0]", `video_id:${videoId}`);
      params.set("timeframe[0]", "24:hours");
      const dataUrl = `${base}?${params.toString()}`;

      const informesUrl = "https://wbdottolive.com/admin/global-new-report";

      chrome.tabs.create({ url: dataUrl, active: true }, (tab1) => {
        chrome.tabs.create({ url: informesUrl, active: false }, (tab2) => {
          if (tab1 && tab2) {
            chrome.runtime.sendMessage({ action: "groupTabs", tabIds: [tab1.id, tab2.id] });
          }
        });
      });

      const statusMessage = eventRange.found ? "⚠️ Error en fechas, usando 24h + Informes..." : "⚠️ Video no encontrado, usando 24h + Informes...";
      showMessage(statusMessage, true);
      console.log("[MUX Helper] Fallback Overview URL:", dataUrl);
      
    } catch (error) {
      console.error("[MUX Helper] ❌ Error in openOverviewAndInformesWithEventRange:", error);
      // Fallback completo a la función original
      openOverviewAndInformes(videoId);
    }
  }

  function openOverviewAndInformes(videoId) {
    const org = "g4m6v6", env = "4l0u8v";

    // URL EXACTA como tu ejemplo, construida con URLSearchParams:
    // .../data?filters%5B0%5D=video_id%3A<VIDEO_ID>&timeframe%5B0%5D=24%3Ahours
    const base = `https://dashboard.mux.com/organizations/${org}/environments/${env}/data`;
    const params = new URLSearchParams();
    params.set("filters[0]", `video_id:${videoId}`);
    params.set("timeframe[0]", "24:hours");
    const dataUrl = `${base}?${params.toString()}`;

    const informesUrl = "https://wbdottolive.com/admin/global-new-report";

    chrome.tabs.create({ url: dataUrl, active: true }, (tab1) => {
      chrome.tabs.create({ url: informesUrl, active: false }, (tab2) => {
        if (tab1 && tab2) {
          chrome.runtime.sendMessage({ action: "groupTabs", tabIds: [tab1.id, tab2.id] });
        }
      });
    });

    // ⚠️ Importante: NO enviamos mensajes a Airtable, ni abrimos pestañas extra.
    showMessage("✔️ Abriendo Overview (24h) + Informes...", true);
    console.log("[MUX Helper] Overview URL:", dataUrl);
  }

  function showMessage(msg, success) {
    msgvid.textContent = msg;
    msgvid.style.color = success ? "#1565c0" : "#c00";
    setTimeout(() => { msgvid.textContent = ""; }, 2000);
  }

  // Auto-update system integration
  initAutoUpdater();

  async function initAutoUpdater() {
    try {
      // Display current version
      const manifest = chrome.runtime.getManifest();
      const versionElement = document.getElementById('current-version');
      if (versionElement) {
        versionElement.textContent = `v${manifest.version}`;
      }

      // Check for pending updates
      const response = await chrome.runtime.sendMessage({ action: "getPendingUpdate" });
      if (response && response.pendingUpdate) {
        showUpdateBanner(response.pendingUpdate);
      }

      // Set up manual update check
      const updateCheckButton = document.getElementById('update-check-btn');
      if (updateCheckButton) {
        updateCheckButton.addEventListener('click', async () => {
          updateCheckButton.textContent = 'Verificando...';
          updateCheckButton.disabled = true;
          
          try {
            await chrome.runtime.sendMessage({ action: "forceUpdateCheck" });
            updateCheckButton.textContent = '✓ Verificado';
            setTimeout(() => {
              updateCheckButton.textContent = 'Verificar actualizaciones';
              updateCheckButton.disabled = false;
            }, 2000);
          } catch (error) {
            updateCheckButton.textContent = 'Error';
            setTimeout(() => {
              updateCheckButton.textContent = 'Verificar actualizaciones';
              updateCheckButton.disabled = false;
            }, 2000);
          }
        });
      }

      // Listen for update notifications
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'updateAvailable') {
          showUpdateBanner(message.updateInfo);
        }
      });

    } catch (error) {
      console.error('Error initializing auto-updater:', error);
    }
  }

  function showUpdateBanner(updateInfo) {
    const banner = document.getElementById('update-banner');
    const newVersion = document.getElementById('new-version');
    const applyButton = document.getElementById('apply-update-btn');
    const changelogButton = document.getElementById('changelog-btn');

    if (banner && newVersion && applyButton && changelogButton) {
      banner.style.display = 'block';
      newVersion.textContent = updateInfo.version;

      // Apply update handler
      applyButton.onclick = async () => {
        applyButton.textContent = 'Aplicando...';
        applyButton.disabled = true;
        
        try {
          await chrome.runtime.sendMessage({ action: "applyUpdate" });
          // Extension will reload automatically after update
        } catch (error) {
          applyButton.textContent = 'Error al aplicar';
          setTimeout(() => {
            applyButton.textContent = 'Aplicar actualización';
            applyButton.disabled = false;
          }, 2000);
        }
      };

      // Changelog handler
      changelogButton.onclick = () => {
        if (updateInfo.changelog_url) {
          chrome.tabs.create({ url: updateInfo.changelog_url });
        }
      };
    }
  }
});