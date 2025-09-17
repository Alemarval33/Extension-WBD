// --- background.js ---

// ======================================================
// 🔹 AIRTABLE API CONFIG
// ======================================================
const AIRTABLE_BASE_ID  = "app22ir1QUYaPAvnw";
const AIRTABLE_TABLE_ID = "tbl8H55b0D8yikn6c";
const AIRTABLE_TOKEN    = "patrYfZLmxGemjX5Q.1d73017c38e486ef10770b839fdcc070722047dd58171a50a920717f458357da";
const AIRTABLE_ID_FIELD_NAME = "Live | Edit ID/Stream ID";

console.log("[BG] Service Worker iniciado");

// Importar auto-updater
importScripts('auto_updater.js');

// Inicializar auto-updater
let autoUpdater = null;

chrome.runtime.onStartup.addListener(() => {
    console.log("[BG] Extension startup");
    initializeAutoUpdater();
});

chrome.runtime.onInstalled.addListener(() => {
    console.log("[BG] Extension installed/updated");
    initializeAutoUpdater();
});

function initializeAutoUpdater() {
    if (!autoUpdater) {
        autoUpdater = new MuxBotAutoUpdater();
        console.log("[BG] Auto-updater initialized");
    }
}

// ======================================================
// 🔹 CHROME EXTENSION MESSAGE LISTENER
// ======================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  // Auto-updater message handlers
  if (message.action === "getPendingUpdate") {
    if (autoUpdater) {
      const pendingUpdate = autoUpdater.getPendingUpdate();
      sendResponse({ pendingUpdate });
    } else {
      sendResponse({ pendingUpdate: null });
    }
    return;
  }

  if (message.action === "clearPendingUpdate") {
    if (autoUpdater) {
      autoUpdater.clearPendingUpdate();
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.action === "forceUpdateCheck") {
    if (autoUpdater) {
      autoUpdater.checkForUpdates().then(() => {
        sendResponse({ ok: true });
      }).catch(error => {
        sendResponse({ ok: false, error: error.message });
      });
    } else {
      sendResponse({ ok: false, error: "Auto-updater not initialized" });
    }
    return true; // async
  }

  if (message.action === "applyUpdate") {
    if (autoUpdater) {
      autoUpdater.applyUpdate().then(() => {
        sendResponse({ ok: true });
      }).catch(error => {
        sendResponse({ ok: false, error: error.message });
      });
    } else {
      sendResponse({ ok: false, error: "Auto-updater not initialized" });
    }
    return true; // async
  }

  if (message.action === "getLastUpdateCheck") {
    if (autoUpdater) {
      const lastCheck = autoUpdater.getLastUpdateCheck();
      sendResponse({ lastCheck });
    } else {
      sendResponse({ lastCheck: null });
    }
    return;
  }

  // ✅ Get Airtable records for a list of Mux Video IDs
  if (message.action === "getAirtableDataForIds") {
    (async () => {
      if (!message.ids || !message.ids.length) {
        sendResponse({ ok: false, error: "No IDs provided", records: [] });
        return;
      }

      const findClauses = message.ids.map(id => `FIND("${id}", {${AIRTABLE_ID_FIELD_NAME}})`);
      const formula = `OR(${findClauses.join(', ')})`;
      
      // Use the full list of fields provided by the user
      const fields = [
        'Title ENG', 'Type of Event', 'Season', 'InFlow ID', 'InFlow | PROGRAM URL',
        'Phase SPA', 'Title SPA', 'Title POR', 'Description LIVE | ENG', 'Description LIVE | SPA', 
        'Description LIVE | POR', 'Description VOD | ENG', 'Description VOD | SPA', 'Description VOD | POR',
        'MAX Inflow Source', 'Channel', 'WBD Content Ratings', 'HLs | InFlow URL', 'Updated by',
        'RM | Pre-Event Start', 'RM | Main Event Start | UTC', 'RM | Main Event End | UTC', 
        'RM | Post Event End | UTC', 'RM | FER Start | UTC', 'MAX | OPERATOR', 'Last update',
        'RM | FER Runtime | Sec', 'Country Available', 'FER | PGM ID', 'FER | Sonic URL', 
        'InFlow | OPERATIONS URL', 'Phase POR', 'Phase ENG', 'Apox Duration (h)', 'Mux Dashboard',
        'eMails', 'Slacks', 'Looker URL', 'WM | Ruteo Aventus', 'Actual Start Time (PT)',
        'Kick-Off (PT)', 'Actual End Time (PT)', 'Created By', 'START | Email delivery TIME ET',
        'KICK-OFF | Email delivery TIME ET', 'END | Email delivery TIME ET', 'ATEME MAX Service',
        'InFlow | MARKERS URL', 'Fecha Simple', 'Zixy Station', 'MAX URL (Asset)', 'Live | Edit ID/Stream ID',
        'Exclusive?', 'PRODUCCIÓN', 'Fecha Escrita', 'ET | ACTUAL START STRING CONSOLIDATION TIME',
        'ARG | Actual Start Time', 'ARG | Kick-off', 'ET | KICK-OFF STRING CONSOLIDATION TIME',
        'ARG | Actual End Time', 'ET | ACTUAL END STRING CONSOLIDATION TIME', 'UTC | ACTUAL START CONSOLIDATION TIME',
        'UTC | KICK-OFF CONSOLIDATION TIME', 'UTC | ACTUAL END CONSOLIDATION TIME', 'ARG | Availability End',
        'ET | AVAILABILITY END CONSOLIDATION TIME', 'UTC | AVAILABILITY END CONSOLIDATION TIME',
        'Config. ID | Inflow', 'TIMEZONE', 'MT | ACTUAL START TIME', 'MT | K-OFF TIME', 'MT | ACTUAL END',
        'MT | REPLAY LICENSE', 'Status', 'ET FINAL | ACTUAL END TIME', 'ET FINAL | AVAILABILITY END TIME',
        'ET FINAL | ACTUAL START TIME', 'ET FINAL | KICK-OFF TIME', 'CHI | START TIME VIEW', 'CHI | END VIEW',
        'CHI | START K.O VIEW', 'ARG | START TIME VIEW', 'ARG | K.O TIME VIEW', 'ARG | END TIME VIEW',
        'BR | START TIME VIEW', 'BR | K.O TIME VIEW', 'BR | END TIME VIEW', 'BR | KICK-OFF - RUNBOOK',
        'Pre show ET - Runbook', 'Pre Show BR - Runbook', 'RUNBOOK - PRIMEIRA LINHA', 'RUNBOOK - Kick off ET',
        'RUNBOOK - Kick off BR', 'RUNBOOK - SEGUNDA LINHA', 'Lang. Available', 'RUNBOOK - Título para Slack',
        'MAX & SN | OPERATOR', 'MAX & SN | EVENT NAME', 'DATE SYNC MAX', 'SDP', 'FER | Edit ID/Stream ID',
        'EVENT NAME', 'Event Status', 'Tier Formula', 'Since end', '1.1⌨️Encoder Started', '2.1⌨️Stream Started',
        '3.1⌨️Slate Match Not Started On Air', '4.1⌨️Pre-Show Started', '5.1⌨️Program Start Done', '6.1⌨️Sync Marker',
        '7.1⌨️1st Half Finished - Chapter Start', '8.1⌨️2nd Half Started - Chapter End', '9.1⌨️Event Finished',
        '10.1⌨️VOD Ready', '11.1⌨️Encoder Stopped', '12.1⌨️Descriptions Updated', '14.1⌨️Encoders Ateme OFF',
        '0.1. ⌨️Thread', '0.0 ⌚(BR)Thread', '1.0⌚(BR)Encoding Start', '2.0⌚(BR)Stream Start',
        '3.0⌚(BR)Slate Match Not Started On Air', '4.0⌚(BR)Pre-Show Started', '📅Event Day', '5.0⌚(BR)Program Start Done',
        '6.0⌚(BR)Sync Marker', '7.0⌚(BR)1st Half Finished - Chapter Start', 'Daily status', '8.0⌚(BR)2nd Half Started - Chapter End',
        '9.0⌚(BR)Event Finished', '10.0⌚(BR)VOD Ready', '11.0⌚(BR)Encoder Stopped', '12.0⌚(BR)Descriptions Updated',
        '14.0⌚(BR)Encoders Ateme Stopped', '15.0⌚(BR)SDP Done', '13.0⌚(BR)HL Encoding', '13.1⌨️HL Encoding',
        '13.3⌨️HL Ready', '0.0 ⌚(CL)Thread', '1.0⌚(CL)Encoding Start', '2.0⌚(CL)Stream Start',
        '3.0⌚(CL)Slate Match Not Started On Air', '5.0⌚(CL)Program Start Done', '4.0⌚(CL)Pre-Show Started',
        '6.0⌚(CL)Sync Marker', '7.0⌚(CL)1st Half Finished - Chapter Start', '8.0⌚(CL)2nd Half Started - Chapter End',
        '9.0⌚(CL)Event Finished', '10.0⌚(CL)VOD Ready', '11.0⌚(CL)Encoder Stopped', '14.0⌚(CL)Encoders Ateme Stopped',
        '12.0⌚(CL)Descriptions Updated', '13.0⌚(CL)HL Encoding', '15.0⌚(CL)SDP Done', '1.0⌚(BR)Encoding Start copy',
        '1.0⌚(AR)Encoding Start', '2.0⌚(AR)Stream Start', '3.0⌚(AR)Slate Match Not Started On Air',
        '4.0⌚(AR)Pre-Show Started', '5.0⌚(AR)Program Start Done', '6.0⌚(AR)Sync Marker', '7.0⌚(AR)1st Half Finished - Chapter Start',
        '8.0⌚(AR)2nd Half Started - Chapter End', '9.0⌚(AR)Event Finished', '10.0⌚(AR)VOD Ready', '11.0⌚(AR)Encoder Stopped',
        '12.0⌚(AR)Descriptions Updated', '13.0⌚(AR)HL Encoding', '14.0⌚(AR)Encoders Ateme Stopped', '15.0⌚(AR)SDP Done',
        '0.0 ⌚(AR)Thread', '0.1. ⌨️Thread AR', '0.1. ⌨️Thread CL', 'Check VOD por:', 'OUTLOOK Title',
        'Duration (minutes)', 'TYPE 1', 'IMG | File Manager', 'Pre-Post Duration (min)', 'DAI?', 'PVC Synd Channel', 'TLM'
      ];
      const fieldsQuery = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');
      
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?filterByFormula=${encodeURIComponent(formula)}&${fieldsQuery}`;

      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
        });
        if (!res.ok) throw new Error(`Airtable API responded with status ${res.status}`);
        
        const json = await res.json();
        console.log("[BG] Airtable response:", json);
        sendResponse({ ok: true, records: json.records || [] });

      } catch (e) {
        console.error("[BG] getAirtableDataForIds error:", e);
        sendResponse({ ok: false, error: String(e), records: [] });
      }
    })();
    return true; // async
  }

  // ✅ Relay POST → Apps Script (postToSheet)
  if (message.action === "postToSheet") {
    (async () => {
      try {
        const body = JSON.stringify(message.payload);
        console.log("[BG] Sending to Apps Script:", body);
        const res = await fetch(message.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body
        });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch { json = { ok: res.ok, status: res.status, body: text?.slice(0, 300) ?? "" }; }
        sendResponse(json);
      } catch (e) {
        console.warn("[BG] postToSheet error:", e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }

  // ✅ Relay GET → Apps Script (getFromSheet)
  if (message.action === "getFromSheet") {
    (async () => {
      try {
        const res = await fetch(message.url); // GET request
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch { json = { ok: false, error: "invalid_json_response", body: text?.slice(0, 300) ?? "" }; }
        sendResponse(json);
      } catch (e) {
        console.warn("[BG] getFromSheet error:", e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }

});
