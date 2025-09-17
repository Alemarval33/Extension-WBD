/*
  content_informes.js — versión limpia + fetch desde Sheet (v1.1)
  ----------------------------------------------------------------
  • Sin lógica vieja de chrome.storage para pegado.
  • Botón flotante ACTIVO: lee muxVideoId del popup, pide fila al Sheet
    vía background.js y muestra preview (sin escribir aún en el DOM).
  • Mantiene drag con Shift. Deja hooks para mapear al formulario.
*/

(() => {
  if (window.__RS_INFORMES_INIT__) return; // evitar doble inyección
  window.__RS_INFORMES_INIT__ = true;

  // ---------- Estado ----------
  const state = {
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    button: null,
    container: null,
  };

  // ---------- Utils ----------
  const log = (...args) => console.log("[RS:Informes]", ...args);

  function toast(msg, ms = 2200) {
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 999999,
      padding: '10px 14px',
      borderRadius: '10px',
      background: 'rgba(0,0,0,.8)',
      color: '#fff',
      fontSize: '13px',
      boxShadow: '0 6px 18px rgba(0,0,0,.25)'
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ---------- Fetch al Sheet por VideoID (lee muxVideoId del popup) ----------
  async function fetchSheetRowByVideoIdAndPreview() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['muxVideoId'], (st) => {
        const videoId = String(st?.muxVideoId || '').trim();
        if (!videoId) {
          toast('⚠️ Falta VideoID en la extensión');
          log('[Informes] No hay muxVideoId en storage.local');
          return resolve({ ok: false, error: 'MISSING_VIDEO_ID' });
        }

        const BASE = (typeof SHEET_WEBHOOK_URL === 'string' && SHEET_WEBHOOK_URL)
          ? SHEET_WEBHOOK_URL
          : 'https://script.google.com/macros/s/AKfycbyny-yj1UGXsZMdyz7GZ8V-j1KgQWUAkXEM3ST1n-Ns5ZpNUkuqIr5oWA8eHaFXYoRKBg/exec';

        // Usamos get_row_data para traer la fila completa A..Z
        const url = `${BASE}?action=get_row_data&event_id=${encodeURIComponent(videoId)}&nocache=${Date.now()}`;

        chrome.runtime.sendMessage({ action: 'getFromSheet', url }, (resp) => {
          if (!resp || resp.ok !== true) {
            log('[Informes] Sheet error:', resp);
            toast('❌ Error consultando Sheet');
            return resolve({ ok: false, error: resp?.error || 'SHEET_ERROR' });
          }

          const rowAZ = resp.data || {};
          // Mostrar por consola la fila completa A..X
          const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
          const filaAX = {};
          for (let i = 0; i < 24; i++) { // A..X son 24 letras
            const letra = letras[i];
            filaAX[letra] = rowAZ[letra] ?? '';
          }
          console.log('[RS:Informes] Fila completa A..X:', filaAX);
          toast('✅ Datos A..X traídos. Ver consola.');

          // === NUEVO: Poner valor de H en el select de categoría ===
          const categoria = filaAX['H'] || '';
          const select = document.getElementById('event_category');
          if (select && categoria) {
            // Buscar opción que coincida exactamente
            let found = false;
            for (const opt of select.options) {
              if (opt.value === categoria) {
                select.value = categoria;
                found = true;
                break;
              }
            }
            if (!found) {
              // Si no hay coincidencia exacta, buscar la opción más parecida
              const normalize = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
              const catNorm = normalize(categoria);
              let bestOpt = null;
              let bestScore = 0;
              for (const opt of select.options) {
                const optNorm = normalize(opt.value);
                // Score: cantidad de palabras de catNorm que aparecen en optNorm
                let score = 0;
                catNorm.split(/\s+/).forEach(word => {
                  if (word && optNorm.includes(word)) score++;
                });
                if (score > bestScore) {
                  bestScore = score;
                  bestOpt = opt;
                }
              }
              if (bestOpt && bestScore > 0) {
                select.value = bestOpt.value;
                toast(`⚠️ Seleccionada opción más parecida: ${bestOpt.value}`);
              } else {
                select.value = '';
                toast(`⚠️ Categoría "${categoria}" no encontrada en el select`);
              }
            } else {
              toast(`Categoría seleccionada: ${categoria}`);
            }
            // Disparar SIEMPRE el evento change (esto es lo importante)
            const changeEvent = new Event('change', { bubbles: true });
            select.dispatchEvent(changeEvent);
            // Si la web usa onchange inline, también lo llamamos
            if (typeof select.onchange === 'function') select.onchange();
          }

          // === NUEVO: Poner valor de I en el select de event_type_argentina ===
          const eventType = filaAX['I'] || '';
          const selectEventType = document.getElementById('event_type_argentina');
          if (selectEventType && eventType) {
            // Buscar opción que coincida exactamente
            let found = false;
            for (const opt of selectEventType.options) {
              if (opt.value === eventType) {
                selectEventType.value = eventType;
                found = true;
                break;
              }
            }
            if (!found) {
              // Si no hay coincidencia exacta, buscar la opción más parecida
              const normalize = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
              const eventTypeNorm = normalize(eventType);
              let bestOpt = null;
              let bestScore = 0;
              for (const opt of selectEventType.options) {
                const optNorm = normalize(opt.value);
                // Score: cantidad de palabras de eventTypeNorm que aparecen en optNorm
                let score = 0;
                eventTypeNorm.split(/\s+/).forEach(word => {
                  if (word && optNorm.includes(word)) score++;
                });
                if (score > bestScore) {
                  bestScore = score;
                  bestOpt = opt;
                }
              }
              if (bestOpt && bestScore > 0) {
                selectEventType.value = bestOpt.value;
                toast(`⚠️ Seleccionada opción más parecida (Event Type): ${bestOpt.value}`);
              } else {
                selectEventType.value = '';
                toast(`⚠️ Valor Event Type "${eventType}" no encontrado en el select`);
              }
            }
            const changeEvent = new Event('change', { bubbles: true });
            selectEventType.dispatchEvent(changeEvent);
            log(`Columna I (Event Type) completada con:`, selectEventType.value);
          }

          // === NUEVO: Poner valor de C en el input de total concurrent plays ===
          const peak = filaAX['C'] || '';
          const inputPeak = document.getElementById('total_concurrent_plays');
          if (inputPeak && peak !== '') {
            inputPeak.value = peak;
            // Disparar input event por si hay lógica asociada
            const inputEvent = new Event('input', { bubbles: true });
            inputPeak.dispatchEvent(inputEvent);
            toast(`Peak (CCV) completado: ${peak}`);
            log(`Columna C (Peak/CCV) completada con:`, peak);
          }

          // === NUEVO: Poner valor de D en el input de views ===
          const views = filaAX['D'] || '';
          const inputViews = document.getElementById('views');
          if (inputViews && views !== '') {
            inputViews.value = views;
            const inputEvent = new Event('input', { bubbles: true });
            inputViews.dispatchEvent(inputEvent);
            toast(`Views completado: ${views}`);
            log(`Columna D (Views) completada con:`, views);
          }

          // === NUEVO: Poner valor de E en el input de unique viewers ===
          const uniqueViewers = filaAX['E'] || '';
          const inputUnique = document.getElementById('unique_viewers');
          if (inputUnique && uniqueViewers !== '') {
            inputUnique.value = uniqueViewers;
            const inputEvent = new Event('input', { bubbles: true });
            inputUnique.dispatchEvent(inputEvent);
            toast(`Unique Viewers completado: ${uniqueViewers}`);
            log(`Columna E (Unique Viewers) completada con:`, uniqueViewers);
          }

          // === NUEVO: Poner valor de J en el input de season ===
          const season = filaAX['J'] || '';
          const inputSeason = document.getElementById('season');
          if (inputSeason && season !== '') {
            inputSeason.value = season;
            const inputEvent = new Event('input', { bubbles: true });
            inputSeason.dispatchEvent(inputEvent);
            toast(`Season completado: ${season}`);
            log(`Columna J (Season) completada con:`, season);
          }

          // === NUEVO: Poner valor de K en el input de stage_instance ===
          const stageInstance = filaAX['K'] || '';
          const inputStage = document.querySelector('input[name="stage_instance"]');
          if (inputStage && stageInstance !== '') {
            inputStage.value = stageInstance;
            const inputEvent = new Event('input', { bubbles: true });
            inputStage.dispatchEvent(inputEvent);
            toast(`Stage Instance completado: ${stageInstance}`);
            log(`Columna K (Stage Instance) completada con:`, stageInstance);
          }

          // === NUEVO: Poner valor de M en el input de kick_off ===
          const kickOff = toTimeHHMM(filaAX['M']);
          const inputKickOff = document.getElementById('kick_off');
          if (inputKickOff && kickOff !== '') {
            inputKickOff.value = kickOff;
            const inputEvent = new Event('input', { bubbles: true });
            inputKickOff.dispatchEvent(inputEvent);
            toast(`Kick Off completado: ${kickOff}`);
            log(`Columna M (Kick Off) completada con:`, kickOff);
          }

          // === NUEVO: Poner valor de O en el input de match_end ===
          const matchEnd = toTimeHHMM(filaAX['O']);
          const inputMatchEnd = document.getElementById('match_end');
          if (inputMatchEnd && matchEnd !== '') {
            inputMatchEnd.value = matchEnd;
            const inputEvent = new Event('input', { bubbles: true });
            inputMatchEnd.dispatchEvent(inputEvent);
            toast(`Match End completado: ${matchEnd}`);
            log(`Columna O (Match End) completada con:`, matchEnd);
          }

          // === NUEVO: Poner valor de P en el input de home_team ===
          const homeTeam = filaAX['P'] || '';
          const inputHomeTeam = document.querySelector('input[name="home_team"]');
          if (inputHomeTeam && homeTeam !== '') {
            inputHomeTeam.value = homeTeam;
            const inputEvent = new Event('input', { bubbles: true });
            inputHomeTeam.dispatchEvent(inputEvent);
            toast(`Home Team completado: ${homeTeam}`);
            log(`Columna P (Home Team) completada con:`, homeTeam);
          }

          // === NUEVO: Poner valor de R en el input de away_team ===
          const awayTeam = filaAX['R'] || '';
          const inputAwayTeam = document.querySelector('input[name="away_team"]');
          if (inputAwayTeam && awayTeam !== '') {
            inputAwayTeam.value = awayTeam;
            const inputEvent = new Event('input', { bubbles: true });
            inputAwayTeam.dispatchEvent(inputEvent);
            toast(`Away Team completado: ${awayTeam}`);
            log(`Columna R (Away Team) completada con:`, awayTeam);
          }

          // === NUEVO: Poner valor de F en el input de video_playback_failure ===
          const playbackFailure = filaAX['F'] || '';
          const inputPlaybackFailure = document.getElementById('video_playback_failure');
          if (inputPlaybackFailure && playbackFailure !== '') {
            inputPlaybackFailure.value = playbackFailure;
            const inputEvent = new Event('input', { bubbles: true });
            inputPlaybackFailure.dispatchEvent(inputEvent);
            toast(`Playback Failure completado: ${playbackFailure}`);
            log(`Columna F (Playback Failure) completada con:`, playbackFailure);
          }

          // === NUEVO: Poner valor de G en el input de ebvs ===
          const ebvs = filaAX['G'] || '';
          const inputEbvs = document.getElementById('ebvs');
          if (inputEbvs && ebvs !== '') {
            inputEbvs.value = ebvs;
            const inputEvent = new Event('input', { bubbles: true });
            inputEbvs.dispatchEvent(inputEvent);
            toast(`EBVS completado: ${ebvs}`);
            log(`Columna G (EBVS) completada con:`, ebvs);
          }

          // === NUEVO: Poner valor de V en el select de amazon ===
          const amazon = filaAX['V'] || '';
          const selectAmazon = document.getElementById('amazon');
          if (selectAmazon && amazon) {
            let found = false;
            for (const opt of selectAmazon.options) {
              if (opt.value === amazon) {
                selectAmazon.value = amazon;
                found = true;
                break;
              }
            }
            if (!found) {
              // Buscar opción más parecida
              const normalize = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
              const amazonNorm = normalize(amazon);
              let bestOpt = null;
              let bestScore = 0;
              for (const opt of selectAmazon.options) {
                const optNorm = normalize(opt.value);
                let score = 0;
                amazonNorm.split(/\s+/).forEach(word => {
                  if (word && optNorm.includes(word)) score++;
                });
                if (score > bestScore) {
                  bestScore = score;
                  bestOpt = opt;
                }
              }
              if (bestOpt && bestScore > 0) {
                selectAmazon.value = bestOpt.value;
                toast(`⚠️ Seleccionada opción más parecida (Amazon): ${bestOpt.value}`);
              } else {
                selectAmazon.value = '';
                toast(`⚠️ Valor Amazon "${amazon}" no encontrado en el select`);
              }
            }
            const changeEvent = new Event('change', { bubbles: true });
            selectAmazon.dispatchEvent(changeEvent);
            log(`Columna V (Amazon) completada con:`, selectAmazon.value);
          }

          // === NUEVO: Poner valor de W en el select de tlm_status ===
          const tlmStatus = filaAX['W'] || '';
          const selectTlm = document.getElementById('tlm_status');
          if (selectTlm && tlmStatus) {
            let found = false;
            for (const opt of selectTlm.options) {
              if (opt.value === tlmStatus) {
                selectTlm.value = tlmStatus;
                found = true;
                break;
              }
            }
            if (!found) {
              // Buscar opción más parecida
              const normalize = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
              const tlmNorm = normalize(tlmStatus);
              let bestOpt = null;
              let bestScore = 0;
              for (const opt of selectTlm.options) {
                const optNorm = normalize(opt.value);
                let score = 0;
                tlmNorm.split(/\s+/).forEach(word => {
                  if (word && optNorm.includes(word)) score++;
                });
                if (score > bestScore) {
                  bestScore = score;
                  bestOpt = opt;
                }
              }
              if (bestOpt && bestScore > 0) {
                selectTlm.value = bestOpt.value;
                toast(`⚠️ Seleccionada opción más parecida (TLM): ${bestOpt.value}`);
              } else {
                selectTlm.value = '';
                toast(`⚠️ Valor TLM "${tlmStatus}" no encontrado en el select`);
              }
            }
            const changeEvent = new Event('change', { bubbles: true });
            selectTlm.dispatchEvent(changeEvent);
            log(`Columna W (TLM) completada con:`, selectTlm.value);
          }

          // === NUEVO: Poner valor de X en el select de dai_status ===
          const daiStatus = filaAX['X'] || '';
          const selectDai = document.getElementById('dai_status');
          if (selectDai && daiStatus) {
            let found = false;
            for (const opt of selectDai.options) {
              if (opt.value === daiStatus) {
                selectDai.value = daiStatus;
                found = true;
                break;
              }
            }
            if (!found) {
              // Buscar opción más parecida
              const normalize = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
              const daiNorm = normalize(daiStatus);
              let bestOpt = null;
              let bestScore = 0;
              for (const opt of selectDai.options) {
                const optNorm = normalize(opt.value);
                let score = 0;
                daiNorm.split(/\s+/).forEach(word => {
                  if (word && optNorm.includes(word)) score++;
                });
                if (score > bestScore) {
                  bestScore = score;
                  bestOpt = opt;
                }
              }
              if (bestOpt && bestScore > 0) {
                selectDai.value = bestOpt.value;
                toast(`⚠️ Seleccionada opción más parecida (DAI): ${bestOpt.value}`);
              } else {
                selectDai.value = '';
                toast(`⚠️ Valor DAI "${daiStatus}" no encontrado en el select`);
              }
            }
            const changeEvent = new Event('change', { bubbles: true });
            selectDai.dispatchEvent(changeEvent);
            log(`Columna X (DAI) completada con:`, selectDai.value);
          }

          resolve({ ok: true, data: filaAX });
        });
      });
    });
  }

  // ---------- Hook para escritura en la página ----------
  function applyReportData(rowObject) {
    // rowObject: { CampoPorHeader1: 'valor', CampoPorHeader2: 'valor', ... }
    // TODO: definir mapping concreto en próxima iteración.
    const mapping = [
      // { key: 'Home Team', selector: 'input[name="home_team"]' },
      // { key: 'Away Team', selector: 'input[name="away_team"]' },
      // { key: 'Peak',      selector: '#total_concurrent_plays' },
    ];

    let escritos = 0;
    for (const m of mapping) {
      const value = rowObject[m.key];
      if (typeof value === 'undefined') continue;
      const el = document.querySelector(m.selector);
      if (!el) continue;
      if ('value' in el) el.value = value;
      else el.textContent = value;
      escritos++;
    }

    toast(`Campos aplicados: ${escritos}`);
    log('applyReportData →', { escritos, rowObject });
  }

  // Exponer helpers para pruebas manuales
  window.rsInformes = {
    fetchSheetRowByVideoIdAndPreview,
    applyReportData,
    toast,
    log,
    version: 'clean-1.1.0'
  };

  // ---------- UI: Botón flotante ----------
  function createFloatingButton() {
    const container = document.createElement('div');
    container.id = 'rs-informes-fab';
    Object.assign(container.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: 999999,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      userSelect: 'none'
    });

    const btn = document.createElement('button');
    btn.id = 'mux-pegar-btn';
    btn.textContent = "Pegar datos de MUX";
    Object.assign(btn.style, {
      appearance: 'none',
      border: '0',
      background: '#1e6fff',
      color: '#fff',
      padding: '10px 14px',
      borderRadius: '12px',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
      fontWeight: '600',
      fontSize: '13px',
      cursor: 'pointer',
      boxShadow: '0 10px 24px rgba(30,111,255,.35)'
    });

    // Click izquierdo: traer datos desde el Sheet (preview por ahora)
    btn.addEventListener('click', async () => {
      toast('Solicitando datos al background…');
      await fetchSheetRowByVideoIdAndPreview();
      // Si quisieras aplicar automáticamente al DOM cuando haya mapping:
      // if (res.ok && res.data && res.data[0]) applyReportData(res.data[0]);
    });

    // Drag con Shift
    btn.title = 'Shift + arrastrar para mover';
    btn.addEventListener('mousedown', (ev) => {
      if (!ev.shiftKey) return;
      state.dragging = true;
      const rect = container.getBoundingClientRect();
      state.dragOffsetX = ev.clientX - rect.left;
      state.dragOffsetY = ev.clientY - rect.top;
      ev.preventDefault();
    });
    document.addEventListener('mousemove', (ev) => {
      if (!state.dragging) return;
      const x = Math.max(0, ev.clientX - state.dragOffsetX);
      const y = Math.max(0, ev.clientY - state.dragOffsetY);
      container.style.left = x + 'px';
      container.style.top = y + 'px';
      container.style.right = 'auto';
      container.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { if (state.dragging) state.dragging = false; });

    container.appendChild(btn);
    document.body.appendChild(container);

    state.button = btn;
    state.container = container;
  }

  // ---------- Init ----------
  function ready(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') return fn();
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  ready(() => {
    try {
      createFloatingButton();
      log('content_informes inicializado.');
      toast('RS Informes listo.');
    } catch (e) {
      log('Error al inicializar:', e);
    }
  });
})();

// --- NUEVO: leer solo la columna H de la fila (vía get_row_data con A..Z) ---
async function fetchColumnHFromSheet() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['muxVideoId'], (st) => {
      const videoId = String(st?.muxVideoId || '').trim();
      if (!videoId) {
        toast('⚠️ Falta VideoID en la extensión');
        console.warn('[Informes] No hay muxVideoId en storage.local');
        return resolve({ ok: false, error: 'MISSING_VIDEO_ID' });
      }

      const BASE = (typeof SHEET_WEBHOOK_URL === 'string' && SHEET_WEBHOOK_URL)
        ? SHEET_WEBHOOK_URL
        : 'https://script.google.com/macros/s/AKfycbyny-yj1UGXsZMdyz7GZ8V-j1KgQWUAkXEM3ST1n-Ns5ZpNUkuqIr5oWA8eHaFXYoRKBg/exec';

      // IMPORTANTE: get_row_data devuelve A..Z (incluye H)
      const url = `${BASE}?action=get_row_data&event_id=${encodeURIComponent(videoId)}&nocache=${Date.now()}`;

      chrome.runtime.sendMessage({ action: 'getFromSheet', url }, (resp) => {
        if (!resp || resp.ok !== true) {
          console.warn('[Informes] get_row_data error:', resp);
          toast('❌ Error consultando Sheet (get_row_data)');
          return resolve({ ok: false, error: resp?.error || 'SHEET_ERROR' });
        }
        // resp.data es un objeto con claves A..Z
        const rowAZ = resp.data || {};
        const valueH = rowAZ.H ?? '';
        console.log('[Informes] Columna H =', valueH, ' — fila A..Z:', rowAZ);
        toast(`🅗 ${String(valueH)}`);
        resolve({ ok: true, H: valueH, rowAZ });
      });
    });
  });
}

// ...agrega esto antes de fetchSheetRowByVideoIdAndPreview...

function toTimeHHMM(val) {
  if (!val) return '';
  // Si es string tipo ISO
  if (typeof val === 'string' && val.includes('T')) {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      // Hora local
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    }
  }
  // Si ya es HH:MM
  if (typeof val === 'string' && /^\d{1,2}:\d{2}$/.test(val.trim())) return val.trim();
  // Si es HH:MM:SS
  const m = String(val).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  // Si es Date
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toTimeString().slice(0,5);
  }
  return '';
}