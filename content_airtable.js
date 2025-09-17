// --- content_airtable.js ---
// ======================================================
// ✅ SCRIPT: Integración API Airtable (OTTO Daily Ops view)
// ------------------------------------------------------
// - Escucha:
//    • { action: "fetchAirtableToday" } → trae registros de HOY usando Field ID robusto.
//    • { action: "fetchAirtableData" }  → (ya existente) busca por Video ID.
// - Usa Table ID (tbl...) y Field ID (fld...) para mayor robustez.
// - Muestra notificaciones usando utils_mod.js si está disponible.
// ======================================================

console.log("[Airtable] content_airtable.js cargado");

// 🔹 Configuración API Airtable (IDs confirmados por el usuario)
const AIRTABLE_BASE_ID  = "app22ir1QUYaPAvnw";
const AIRTABLE_TABLE_ID = "tbl8H55b0D8yikn6c";     // Tabla (misma que antes)
const AIRTABLE_VIEW_ID  = "viwyxGJMMAIHtbmtT";     // 🆕 Vista: OTTO Daily Ops view
const AIRTABLE_DATE_FID = "fldHgMjzEQSv3SYTM";     // Campo fecha/hora (Field ID)

// Endpoint base usando Table ID
const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`;

// 🔑 Token (queda hardcodeado a pedido del usuario - no distribuye la extensión)
const AIRTABLE_TOKEN = "patrYfZLmxGemjX5Q.1d73017c38e486ef10770b839fdcc070722047dd58171a50a920717f458357da";

// ======================================================
// 🔸 Listener principal de mensajes
// ======================================================
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  // ----------------------------------------------------------------
  // 1) Traer registros de HOY (por fecha usando Field ID)
  // ----------------------------------------------------------------
  if (req.action === "fetchAirtableToday") {
    console.log("[Airtable] FetchAirtableToday solicitado");

    // Fórmula robusta por Field ID
    const formulaToday = `IS_SAME({${AIRTABLE_DATE_FID}}, TODAY(), 'day')`;

    const params = new URLSearchParams({
      filterByFormula: formulaToday,
      view: AIRTABLE_VIEW_ID, // respeta orden/filtros de la vista OTTO Daily Ops view
      pageSize: "100"
    });

    const url = `${AIRTABLE_URL}?${params.toString()}`;
    console.log("[DEBUG-AIRTABLE] URL hoy:", url);

    fetchAirtable(url).then((records) => {
      if (!records || records.length === 0) {
        notify("⚠️ No hay registros para HOY", false);
        sendResponse({ status: "not_found", records: [] });
        return;
      }
      console.log(`[DEBUG-AIRTABLE] Registros de HOY: ${records.length}`);
      notify(`✔️ ${records.length} registro(s) de HOY`, true);
      sendResponse({ status: "ok", records });
    });

    return true; // async
  }

  // ----------------------------------------------------------------
  // 2) Flujo por Video ID (mantener compatibilidad con lo ya hecho)
  // ----------------------------------------------------------------
  if (req.action === "fetchAirtableData") {
    console.log("[Airtable] FetchAirtableData solicitado");

    chrome.storage.local.get(["muxVideoId"], async (data) => {
      const videoId = data.muxVideoId;
      if (!videoId) {
        notify("❌ No hay Video ID.", false);
        sendResponse({ status: "error", error: "No Video ID" });
        return;
      }

      // Pedimos explícitamente estos campos (ajustables)
      const fieldsParam = [
        "fields[]=Mux%20Dashboard",
        "fields[]=Live%20%7C%20Edit%20ID%2FStream%20ID",
        "fields[]=DAI%3F"
      ].join("&");

      // Intento 1: exacto por nombre (compatibilidad histórica)
      const formulaExact = `={Live | Edit ID/Stream ID}="${videoId}"`;
      let url = `${AIRTABLE_URL}?filterByFormula=${encodeURIComponent(formulaExact)}&${fieldsParam}`;
      let result = await fetchAirtable(url);

      // Intento 2 (fallback): FIND()
      if (!result || result.length === 0) {
        const formulaFallback = `FIND("${videoId}", {Live | Edit ID/Stream ID})`;
        url = `${AIRTABLE_URL}?filterByFormula=${encodeURIComponent(formulaFallback)}&${fieldsParam}`;
        result = await fetchAirtable(url);
      }

      if (!result || result.length === 0) {
        console.warn(`[DEBUG-AIRTABLE] Registro no encontrado para Video ID: ${videoId}`);
        notify("❌ Mux Dashboard no encontrado", false);
        const airtableExtra = { mux_dashboard_url: null, dai_status: null };
        chrome.storage.local.set({ airtableExtra }, () =>
          sendResponse({ status: "not_found", data: airtableExtra })
        );
        return;
      }

      const fieldsData = result[0].fields || {};
      const mux_dashboard_url = fieldsData["Mux Dashboard"] || null;
      const dai_status = fieldsData["DAI?"] || null;

      if (mux_dashboard_url) {
        console.log(`[DEBUG-AIRTABLE] Mux Dashboard encontrado: ${mux_dashboard_url}`);
        notify("✔️ URL Mux Dashboard obtenida", true);
      } else {
        console.warn(`[DEBUG-AIRTABLE] Campo 'Mux Dashboard' vacío para Video ID: ${videoId}`);
        notify("⚠️ Mux Dashboard vacío", false);
      }

      if (dai_status) {
        console.log(`[DEBUG-AIRTABLE] DAI? encontrado: ${dai_status}`);
        notify(`✔️ DAI?: ${dai_status}`, true);
      } else {
        console.warn(`[DEBUG-AIRTABLE] Campo 'DAI?' vacío para Video ID: ${videoId}`);
        notify("⚠️ DAI? vacío", false);
      }

      const airtableExtra = { mux_dashboard_url, dai_status };
      chrome.storage.local.set({ airtableExtra }, () =>
        sendResponse({ status: "ok", data: airtableExtra })
      );
    });

    return true; // async
  }
});

// ======================================================
// 🔹 FUNCIONES AUXILIARES
// ======================================================

async function fetchAirtable(url) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    console.log("[DEBUG-AIRTABLE] Respuesta cruda:", json);
    return json.records || [];
  } catch (err) {
    console.error("[DEBUG-AIRTABLE] Error API:", err);
    return [];
  }
}

// Notificación visual (usa utils_mod.js si está)
function notify(msg, success) {
  if (typeof showFloatingMessage === "function") showFloatingMessage(msg, success);
  else console.log("[Airtable] " + msg);
}
