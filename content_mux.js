// content_mux.js - VERSIÓN MÍNIMA DE PRUEBA

(function () {
  const BUTTON_ID = "mux-data-btn";
  const STYLE_ID = "mux-data-style";
  const STYLE = `
    #${BUTTON_ID}{
      z-index:99999; position:fixed; bottom:24px; right:24px;
      background:#2196F3; color:#fff; border:none; border-radius:1.2em;
      padding:8px 22px; font-size:16px; font-weight:bold; cursor:pointer
    }
    #mux-data-toast{
      z-index:100000; position:fixed; bottom:70px; right:28px; background:#1565c0;
      color:#fff; padding:9px 20px; border-radius:1.2em; font-size:16px;
      font-weight:bold; opacity:.98; display:none
    }
  `;

  ensureStyle();
  ensureCopyButtons();

  function ensureStyle() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
  }

  function ensureCopyButtons() {
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.innerText = "Copiar datos Overview";
    document.body.appendChild(btn);

    const toast = document.createElement("div");
    toast.id = "mux-data-toast";
    document.body.appendChild(toast);

    btn.onclick = async () => {
      try {
        // Video ID desde storage o URL
        const vid = await getVideoId();
        if (!vid) {
          showToast("❌ Falta Video ID");
          return;
        }

        // Extraer 4 métricas del Overview
        const m = extractOverviewMetrics();

        // Preparar payload para D-G (no importa el orden, usamos 4 columnas)
        const payload = {
          action: 'upsert_overview_metrics',
          event_id: vid,
          d: m.views,
          e: m.unique,
          f: m.playbackFailurePct,
          g: m.videoStartupFailurePct
        };

        const resp = await (typeof postToSheet === 'function' ? postToSheet(payload) : Promise.resolve({ ok: false, error: 'postToSheet_missing' }));
        if (!resp?.ok) {
          showToast("❌ Error enviando métricas");
          console.warn("[MUX Overview] Error al enviar D-G:", resp);
        } else {
          // La primera notificación fue eliminada por pedido del usuario.
          // Se muestra una única notificación al final.

          // Luego: traer Airtable y completar H-K (solo si vacío)
          try {
            const air = await getAirtableForId(vid);
            if (air) {
              const ch  = normalizeAnyFieldValue(air['Channel']);
              const ca  = normalizeAnyFieldValue(air['Country Available']);
              const sea = normalizeAnyFieldValue(air['Season']);
              const phe = normalizeAnyFieldValue(air['Phase ENG']);
              const typ = normalizeAnyFieldValue(air['Type of Event']);
              const mArg = normalizeAnyFieldValue(air['ARG | Kick-off'] || air['ARG | START K.O VIEW'] || air['ARG | START TIME VIEW']);
              const mChi = normalizeAnyFieldValue(air['CHI | Kick-off'] || air['CHI | START K.O VIEW'] || air['CHI | START TIME VIEW']);
              const durRaw = air['Aprox Duration (h)'] ?? air['Apox Duration (h)'];
              const dur = typeof durRaw === 'number' ? durRaw : (parseFloat(String(durRaw || '').replace(',', '.')) || '');
              const pvc = normalizeAnyFieldValue(air['PVC Synd Channel']) || 'Not Available';
              const tlmAir = normalizeAnyFieldValue(air['TLM']) || 'Not Available';
              const daiAir = normalizeAnyFieldValue(air['DAI?']) || 'Not Available';

              const respHK = await postToSheet({
                action: 'fill_airtable_fields_if_empty',
                event_id: vid,
                H: ch,
                I: ca,
                J: sea,
                K: phe,
                L: typ,
                M_ARG: mArg,
                M_CHI: mChi,
                N: dur,
                T: 'Available',
                U: 'Available',
                V: pvc,
                W: tlmAir,
                X: daiAir
              });
              if (respHK?.ok) {
                showToast("✅ Métricas enviadas");
              } else {
                showToast("⚠️ D-G ok, H-K error");
                console.warn('[MUX Overview] Error H-K:', respHK);
              }
            } else {
              showToast("⚠️ D-G ok, Airtable vacío");
            }
          } catch (e) {
            showToast("⚠️ D-G ok, Airtable error");
            console.warn('[MUX Overview] Airtable fetch error:', e);
          }
        }
      } catch (e) {
        showToast("❌ Error en la extensión");
        console.warn("[MUX Overview] Error:", e);
      }
    };
  }

  function extractOverviewMetrics() {
    const root = document.querySelector('#main-content') || document.body;

    function parseKMBText(numText, unitText) {
      const n = String(numText || '').trim();
      const u = String(unitText || '').trim().toUpperCase();
      if (!n) return null;
      const base = parseFloat(n.replace(',', '.'));
      if (!Number.isFinite(base)) return null;
      const mult = u === 'K' ? 1e3 : u === 'M' ? 1e6 : u === 'B' ? 1e9 : u === 'T' ? 1e12 : 1;
      return Math.round(base * mult);
    }

    function getCardValue(label) {
      // 1) Método robusto: localizar el <p> con el texto exacto del label y leer h2/h3 cercanos
      const ps = Array.from(root.querySelectorAll('p'));
      const pEl = ps.find(p => (p.textContent || '').trim().toLowerCase() === label.toLowerCase());
      if (pEl) {
        // Dentro del mismo contenedor
        let container = pEl.parentElement || null;
                if (container) {
          const h2a = container.querySelector('h2');
          const h3a = container.querySelector('h3');
          const parsedA = parseKMBText(h2a?.textContent, h3a?.textContent);
          if (parsedA != null) return parsedA;
        }
        // En el siguiente hermano
        if (pEl.nextElementSibling) {
          const h2b = pEl.nextElementSibling.querySelector?.('h2');
          const h3b = pEl.nextElementSibling.querySelector?.('h3');
          const parsedB = parseKMBText(h2b?.textContent, h3b?.textContent);
          if (parsedB != null) return parsedB;
        }
        // Un nivel arriba y buscar h2/h3
        if (container && container.parentElement) {
          const h2c = container.parentElement.querySelector('h2');
          const h3c = container.parentElement.querySelector('h3');
          const parsedC = parseKMBText(h2c?.textContent, h3c?.textContent);
          if (parsedC != null) return parsedC;
        }
      }
      // 2) Fallback por clases conocidas (por si cambia el DOM)
      const cards = Array.from(root.querySelectorAll('div.sc-gsTCUz'));
      const card = cards.find(c => (c.textContent || '').trim().toLowerCase().includes(label.toLowerCase()));
      if (card) {
        const h2 = card.querySelector('h2');
        const h3 = card.querySelector('h3');
        const parsed = parseKMBText(h2?.textContent, h3?.textContent);
        if (parsed != null) return parsed;
      }
      return null;
    }

    function getRowPercent(label) {
      const rows = Array.from(root.querySelectorAll('[role="row"]'));
      const row = rows.find(r => (r.textContent || '').toLowerCase().includes(label.toLowerCase()));
      if (!row) return null;
      const cells = Array.from(row.querySelectorAll('[role="cell"]'));
      // suele estar en la última celda de la fila
      const valCell = cells[cells.length - 1];
      const t = (valCell?.textContent || '').trim();
      const m = t.match(/(-?\d+(?:[.,]\d+)?)\s*%/);
      if (!m) return null;
      const v = parseFloat(m[1].replace(',', '.'));
      return Number.isFinite(v) ? v : null;
    }

    const views = getCardValue('Views');
    const unique = getCardValue('Unique Viewers');
    const playbackFailurePct = getRowPercent('Playback Failure Percentage');
    const videoStartupFailurePct = getRowPercent('Exits Before Video Start');

    return { views, unique, playbackFailurePct, videoStartupFailurePct };
  }

  function showToast(message) {
    const toast = document.getElementById("mux-data-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.style.display = "block";
    toast.style.opacity = "1";
    setTimeout(() => (toast.style.opacity = "0"), 2500);
    setTimeout(() => (toast.style.display = "none"), 2900);
  }

  async function getVideoId() {
    // 1) intentar storage
    const vid = await new Promise((resolve) => {
      chrome.storage.local.get(["muxVideoId"], (data) => resolve(data?.muxVideoId || null));
    });
    if (vid) return vid;
    // 2) intentar URL (filters[0]=video_id:<ID>)
    try {
      const url = new URL(window.location.href);
      const params = new URLSearchParams(url.search);
      const f0 = params.get('filters[0]');
      if (f0 && f0.startsWith('video_id:')) return f0.split(':')[1];
    } catch (_) {}
    return null;
  }

  function normalizeAnyFieldValue(v) {
    if (v == null) return "";
    if (Array.isArray(v)) {
      const simple = v.every(x => ["string","number","boolean"].includes(typeof x) || x == null);
      return simple ? v.map(x => x == null ? "" : String(x)).join(", ") : JSON.stringify(v);
    }
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  function getAirtableForId(videoId) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getAirtableDataForIds', ids: [videoId] }, (res) => {
        if (res?.ok && Array.isArray(res.records) && res.records.length > 0) {
          resolve(res.records[0].fields || {});
          } else {
          resolve(null);
        }
      });
    });
  }
})();