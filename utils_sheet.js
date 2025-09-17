// utils_sheet.js
// Re-activación: envío/lectura al Web App (Google Apps Script) vía background

const SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxzkAGE805YTk7LAYm5Kbby9rdeFZ5xpz2AXS808rsKP4PaVk3QcWN1BDVF2mg59tth/exec";

/**
 * Envía datos al Google Sheet vía Apps Script, a través del background.
 * @param {Object} payload - { event_id, event_ids?, airtable_data: { Views, Unique Viewers, ... } }
 * @returns {Promise<Object>} { ok:true } o { ok:false,error:"..." }
 */
function postToSheet(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "postToSheet", url: SHEET_WEBHOOK_URL, payload },
      (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { ok: false, error: "no response" });
        }
      }
    );
  });
}

/**
 * Obtiene datos del Google Sheet (p.ej. peak) vía Apps Script, a través del background.
 * Manteniendo interfaz por si en el futuro se reusa.
 */
function getFromSheet(eventId) {
  return new Promise((resolve) => {
    const url = new URL(SHEET_WEBHOOK_URL);
    url.searchParams.set('action', 'get_peak');
    url.searchParams.set('event_id', eventId);
    chrome.runtime.sendMessage(
      { action: "getFromSheet", url: url.toString() },
      (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { ok: false, error: "no response" });
        }
      }
    );
  });
}


