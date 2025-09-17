// --- content_monitoring.js v7 (Optimizado y Limpio) ---
// Monitoreo automático con datos de Airtable y escritura en Google Sheets

// --- URL del Apps Script ---
const SHEET_API_URL = 'https://script.google.com/macros/s/AKfycbzTdjpOHMJtfVTr8N21QiztipgFW5O201ZHmItK9Q79VuVE1pjPXWkCKYjI4UtCC1UO/exec';

// =====================================================
// ✅ SCRIPT: Monitoreo AUTOMÁTICO con datos de AIRTABLE
//     - Une los nombres de múltiples eventos si se filtran varios IDs.
//     - Escribe campos de Airtable (incl. País) solo en la primera escritura,
//       luego envía únicamente el peak.
//     - Conserva el botón "Copiar datos" y todo lo existente.
// =====================================================

(async () => {
    const log = (...args) => console.log("[MuxAutoMonitor]", ...args);

    // --- State Variables ---
    let eventIds = [];
    let eventIdsKey = '';
    let airtableRecord = {};      
    let combinedEventName = '';   
    let pagePeak = 0;
    let sheetPeak = 0;
    let isMonitoring = false;
    let mainInterval = null;
    
    // Control de primer envío y espera de Airtable
    let airtableFetchPromise = null;
    let airtableReady = false;
    let firstWriteInProgress = false;
    let firstWriteDone = false;
    let backfillScheduled = false;
    let firstBackfillDone = false;
    let initialAirtableFillDone = false;
    
    // Claves de almacenamiento
    const BASIC_KEY = "muxBasicRows";
    const ONCE_KEY = "muxOnceWritten";

    // --- Airtable Configuration ---
    const AIRTABLE_CONFIG = {
        BASE_ID: "app22ir1QUYaPAvnw",
        TABLE_ID: "tbl8H55b0D8yikn6c",
        TOKEN: "patrYfZLmxGemjX5Q.1d73017c38e486ef10770b839fdcc070722047dd58171a50a920717f458357da",
        FIELDS: {
            STREAM: "fldFog2InOEhM1nNz",
            STAGE: "fldN3G4CXoW7ZTtw9",
            START_TIME: "fldTgFtNcGpW32Jmg",
            SEASON: "fldQMqym23qJ8YZD9",
            EVENT_NAME: "fldNcvNNlF4MGyOLt",
            EVENT_CATEGORY: "fld6dQYFFDIiAWx1I",
            EVENT_TYPE: "fld8SFfkQBg0nAGfE",
            DAI: "fldvRbBVeaezQVmsi",
            TLM: "fldaC4IbEmdRAdiCW",
            SYNDICATION: "fldp839iEOiajNivc"
        }
    };
    
    const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.BASE_ID}/${AIRTABLE_CONFIG.TABLE_ID}`;

    async function initialize() {
        log("Initializing script on page...");

        // 1. Extraer IDs de la URL
        eventIds = extractVideoIdsFromUrl();
        if (eventIds.length === 0) {
            log("No video_id filter found in URL. Monitoring will not start.");
            return;
        }

        eventIdsKey = eventIds.join(', ');
        log(`Video_id(s) filter detected: [${eventIdsKey}].`);

        // 2. Traer datos de Airtable
        initializeAirtableData();

        isMonitoring = true;
        sheetPeak = 0;

        // 3. Iniciar chequeo periódico
        startPeriodicCheck();

        // 4. Iniciar el cartel flotante
        initializeFloatingPill();
    }

    function extractVideoIdsFromUrl() {
        const url = window.location.href;
        const regex = /filters%5B\d*%5D=video_id%3A([^&]+)/g;
        const foundIds = [];
        let match;
        
        while ((match = regex.exec(url)) !== null) {
            foundIds.push(decodeURIComponent(match[1]));
        }
        
        return Array.from(new Set(foundIds)); // eliminar duplicados
    }

    function initializeAirtableData() {
        log("Fetching data from Airtable...");
        airtableFetchPromise = new Promise((resolve) => {
            chrome.runtime.sendMessage({ 
                action: 'getAirtableDataForIds', 
                ids: eventIds 
            }, (airtableResponse) => {
                if (airtableResponse?.ok && airtableResponse.records?.length > 0) {
                    const allNames = airtableResponse.records
                        .map(rec => rec.fields['Title ENG'] || '')
                        .filter(Boolean);
                    combinedEventName = allNames.join(' | ');
                    airtableRecord = airtableResponse.records[0].fields || {};
                    airtableReady = true;
                    log(`Airtable data received for ${airtableResponse.records.length} records. Combined Name: ${combinedEventName}`);
                } else {
                    log("Could not fetch data from Airtable or no records found.", airtableResponse?.error);
                    airtableRecord = {};
                    combinedEventName = '';
                }
                resolve(airtableRecord);
            });
        });
    }

    function startPeriodicCheck() {
        if (mainInterval) clearInterval(mainInterval);
        mainInterval = setInterval(runCheck, 1000); // Cambiar de 2000ms a 1000ms (1 segundo)
        runCheck();
    }

    async function runCheck() {
        if (!isMonitoring) return;

        const currentOnPage = findPeakOnPage();
        
        // Completar H/I/J/K desde Airtable una sola vez cuando esté listo
        if (airtableReady && !initialAirtableFillDone) {
            try { 
                await maybeFillAirtableHK(); 
            } catch (error) {
                console.warn("Error filling Airtable fields:", error);
            }
        }
        
        if (currentOnPage <= pagePeak) return;

        log(`New page peak detected: ${currentOnPage}`);
        
        // Reconciliar contra Sheet antes de continuar
        const consistency = await ensurePeakConsistency(currentOnPage);
        if (consistency?.source === 'sheet') {
            // El Sheet tiene un peak mayor: reflejarlo en UI y no escribir
            pagePeak = consistency.decidedPeak;
            sheetPeak = Math.max(sheetPeak, pagePeak);
            updateTitle();
            return;
        }
        
        pagePeak = consistency?.decidedPeak ?? currentOnPage;

        if (pagePeak > sheetPeak) {
            await handlePeakUpdate();
        }
        
        updateTitle();
    }

    async function handlePeakUpdate() {
        log(`New peak (${pagePeak}) is higher than sheet peak (${sheetPeak}). UPDATING SHEET.`);
        sheetPeak = pagePeak;

        // ¿Ya escribimos Airtable para este set de IDs?
        const reg0 = await loadOnceRegistry();
        const alreadyOnce = !!reg0[eventIdsKey] || firstWriteDone;
        
        console.log("🔍 PEAK UPDATE: Análisis de estado");
        console.log("📝 PEAK UPDATE: eventIdsKey:", eventIdsKey);
        console.log("📝 PEAK UPDATE: reg0[eventIdsKey]:", reg0[eventIdsKey]);  
        console.log("📝 PEAK UPDATE: firstWriteDone:", firstWriteDone);
        console.log("📝 PEAK UPDATE: alreadyOnce:", alreadyOnce);
        console.log("📝 PEAK UPDATE: firstWriteInProgress:", firstWriteInProgress);

        // Evitar duplicados si ya hay envío en curso
        if (!alreadyOnce && firstWriteInProgress) return;

        // Refuerzo: obtener campos clave por Field ID
        const primary = await fetchPrimaryAirtableFieldsForIds(eventIds);

        if (!alreadyOnce) {
            console.log("✅ PEAK UPDATE: Ejecutando handleFirstWrite");
            await handleFirstWrite(primary);
        } else {
            console.log("⚡ PEAK UPDATE: Ejecutando handleSubsequentWrite");
            await handleSubsequentWrite();
        }

        // Intento no intrusivo de escribir fila básica A/B/C: [VideoID, Nombre, Peak]
        try {
            await maybeAppendBasicRow();
        } catch (error) {
            console.warn("Basic row append skipped:", error);
        }
    }

    // Función para normalizar formatos de fecha de Airtable
    function normalizeDateFromAirtable(dateValue) {
        if (!dateValue) return '';
        
        console.log("📅 NORMALIZING DATE: Input:", dateValue, "Type:", typeof dateValue);
        
        try {
            let date;
            
            // Caso 1: Formato ISO (ej: '2025-09-12T00:54:00.000Z')
            if (typeof dateValue === 'string' && dateValue.includes('T') && dateValue.includes('Z')) {
                date = new Date(dateValue);
                console.log("📅 NORMALIZING DATE: Caso ISO");
            }
            // Caso 2: Formato con prefijo país (ej: 'ARG - 16/09/2025 - 21:54')
            else if (typeof dateValue === 'string' && dateValue.match(/^[A-Z]{3}\s-\s\d{2}\/\d{2}\/\d{4}\s-\s\d{2}:\d{2}$/)) {
                console.log("📅 NORMALIZING DATE: Caso con prefijo país");
                // Remover el prefijo del país "ARG - "
                const withoutPrefix = dateValue.replace(/^[A-Z]{3}\s-\s/, '');
                console.log("📅 NORMALIZING DATE: Sin prefijo:", withoutPrefix);
                
                // Parsear '16/09/2025 - 21:54' (dd/MM/yyyy)
                const [datePart, timePart] = withoutPrefix.split(' - ');
                const [day, month, year] = datePart.split('/');
                
                // Crear fecha en formato ISO: yyyy-MM-ddTHH:mm:ss
                const isoString = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart}:00`;
                console.log("📅 NORMALIZING DATE: ISO construido:", isoString);
                date = new Date(isoString);
            }
            // Caso 3: Formato personalizado (ej: '2025/09/11 - 21:54')
            else if (typeof dateValue === 'string' && dateValue.includes('/') && dateValue.includes(' - ')) {
                console.log("📅 NORMALIZING DATE: Caso formato personalizado");
                // Convertir '2025/09/11 - 21:54' a '2025-09-11T21:54:00'
                const [datePart, timePart] = dateValue.split(' - ');
                const normalizedDate = datePart.replace(/\//g, '-');
                const isoString = `${normalizedDate}T${timePart}:00`;
                date = new Date(isoString);
            }
            // Caso 4: Otros formatos de string
            else if (typeof dateValue === 'string') {
                console.log("📅 NORMALIZING DATE: Caso string genérico");
                date = new Date(dateValue);
            }
            // Caso 5: Ya es un objeto Date
            else if (dateValue instanceof Date) {
                console.log("📅 NORMALIZING DATE: Ya es Date");
                date = dateValue;
            }
            else {
                console.log("📅 NORMALIZING DATE: Formato desconocido, retornando string");
                return String(dateValue);
            }
            
            // Validar que la fecha es válida
            if (isNaN(date.getTime())) {
                console.warn('Invalid date format:', dateValue);
                return String(dateValue);
            }
            
            console.log("📅 NORMALIZING DATE: Date objeto:", date);
            
            // Retornar en formato ISO estándar sin la Z (para que Apps Script lo procese mejor)
            const result = date.toISOString().slice(0, 19).replace('T', ' ');
            console.log("📅 NORMALIZING DATE: Resultado final:", result);
            return result;
            
        } catch (error) {
            console.warn('Error normalizing date:', dateValue, error);
            return String(dateValue);
        }
    }

    async function handleFirstWrite(primary) {
        firstWriteInProgress = true;
        
        console.log("🚀 FIRST WRITE: Iniciando - airtableReady:", airtableReady, "airtableRecord existe:", !!airtableRecord);
        
        // Si ya tenemos datos de Airtable listos, incluir M, N, O desde el primer envío
        if (airtableReady && airtableRecord) {
            console.log("✅ FIRST WRITE: Airtable está listo, usando datos existentes");
            console.log("📋 FIRST WRITE: airtableRecord:", airtableRecord);
            // Obtener fechas usando la misma lógica que el botón Overview (sin normalización compleja)
            const mArg = normalizeAnyFieldValue(airtableRecord['ARG | Kick-off'] || 
                                              airtableRecord['ARG | K.O TIME VIEW'] || 
                                              airtableRecord['ARG | START TIME VIEW']);
            const mChi = normalizeAnyFieldValue(airtableRecord['CHI | Kick-off'] || 
                                               airtableRecord['CHI | START K.O VIEW'] || 
                                               airtableRecord['CHI | START TIME VIEW']);
            
            // Duración: manejar tanto el campo con typo como sin typo
            const durRaw = airtableRecord['Aprox Duration (h)'] ?? airtableRecord['Apox Duration (h)'];
            const dur = typeof durRaw === 'number' ? durRaw : (parseFloat(String(durRaw || '').replace(',', '.')) || '');
            
            console.log("🕒 FIRST WRITE: Fechas obtenidas - ARG:", mArg, "CHI:", mChi, "DUR:", durRaw);
            console.log("🎯 FIRST WRITE: Datos para M/N/O - M_ARG:", mArg, "M_CHI:", mChi, "N:", dur);
            
            log('Normalized dates for first write:', { M_ARG: mArg, M_CHI: mChi, N: dur });
            
            // Usar la acción upsert_bundle que maneja todo en una sola llamada
            const payloadBundle = {
                action: 'upsert_bundle',
                event_id: eventIds[0], // Apps Script espera un solo ID
                name: combinedEventName || '',
                monitoring_peak: pagePeak,
                overview: {}, // Sin métricas de overview en este momento
                airtable: {
                    H: normalizeAnyFieldValue(airtableRecord['Event Category']) || normalizeAnyFieldValue(airtableRecord['Channel']) || '',
                    I: normalizeAnyFieldValue(airtableRecord['Country Available']) || '',
                    J: normalizeAnyFieldValue(airtableRecord['Season']) || '',
                    K: normalizeAnyFieldValue(airtableRecord['Phase ENG']) || '',
                    L: normalizeAnyFieldValue(airtableRecord['Type of Event']) || '',
                    M_ARG: mArg,
                    M_CHI: mChi,
                    N: dur,
                    T: 'Available',
                    U: 'Available',
                    V: normalizeAnyFieldValue(airtableRecord['Syndication']) || normalizeAnyFieldValue(airtableRecord['PVC Synd Channel']) || '',
                    W: normalizeAnyFieldValue(airtableRecord['Timeline Markers']) || normalizeAnyFieldValue(airtableRecord['TLM']) || '',
                    X: normalizeAnyFieldValue(airtableRecord['Dynamic Ad Insertion']) || normalizeAnyFieldValue(airtableRecord['DAI?']) || ''
                }
            };
            
            console.log("📤 FIRST WRITE: Payload enviado a Sheet:", JSON.stringify(payloadBundle, null, 2));
            
            const respFirst = await postToSheet(payloadBundle);
            console.log("📥 FIRST WRITE: Respuesta del Sheet:", respFirst);
            if (respFirst?.ok) {
                log("Sheet updated (FIRST write with Airtable M/N/O).", respFirst);
                const reg = await loadOnceRegistry();
                reg[eventIdsKey] = { t: Date.now() };
                await saveOnceRegistry(reg);
                firstWriteDone = true;
            } else {
                console.error("Failed to update sheet (FIRST write):", respFirst?.error || respFirst);
            }
        } else {
            // Sin datos de Airtable LISTOS, pero intentar obtenerlos ahora para M,N,O
            log("Airtable no está listo, intentando obtener datos para M,N,O...");
            
            // Intentar obtener datos de Airtable para el primer write
            try {
                if (!airtableRecord && eventIds?.length > 0) {
                    // Usar el mismo patrón que initializeAirtableData()
                    console.log("🔄 EMERGENCY: Solicitando datos de Airtable para eventIds:", eventIds);
                    const tempAirtableResp = await new Promise((resolve) => {
                        chrome.runtime.sendMessage({ 
                            action: 'getAirtableDataForIds', 
                            ids: eventIds 
                        }, (response) => {
                            console.log("📥 EMERGENCY: Respuesta completa de Airtable:", response);
                            resolve(response);
                        });
                    });
                    
                    console.log("🧐 EMERGENCY: Analizando respuesta - ok:", tempAirtableResp?.ok, "records length:", tempAirtableResp?.records?.length);
                    
                    if (tempAirtableResp?.ok && tempAirtableResp?.records?.length > 0) {
                        // Usar el primer registro encontrado
                        const tempRecord = tempAirtableResp.records[0].fields;
                        console.log("📋 EMERGENCY: Primer registro de Airtable:", tempRecord);
                        
                        // Obtener fechas usando la misma lógica que el botón Overview (sin normalización compleja)
                        const mArg = normalizeAnyFieldValue(tempRecord['ARG | Kick-off'] || 
                                                           tempRecord['ARG | K.O TIME VIEW'] || 
                                                           tempRecord['ARG | START TIME VIEW']);
                        const mChi = normalizeAnyFieldValue(tempRecord['CHI | Kick-off'] || 
                                                            tempRecord['CHI | START K.O VIEW'] || 
                                                            tempRecord['CHI | START TIME VIEW']);
                        
                        console.log("🕒 EMERGENCY: Fechas obtenidas - ARG:", mArg, "CHI:", mChi);
                        
                        // Duración
                        const durRaw = tempRecord['Aprox Duration (h)'] ?? tempRecord['Apox Duration (h)'];
                        const dur = typeof durRaw === 'number' ? durRaw : (parseFloat(String(durRaw || '').replace(',', '.')) || '');
                        
                        console.log("🎯 EMERGENCY: Datos para M/N/O - M_ARG:", mArg, "M_CHI:", mChi, "N:", dur);
                        
                        log('Fetched Airtable data for first write:', { M_ARG: mArg, M_CHI: mChi, N: dur });
                        
                        // Enviar con datos completos de Airtable
                        const payloadBundle = {
                            action: 'upsert_bundle',
                            event_id: eventIds[0],
                            name: combinedEventName || '',
                            monitoring_peak: pagePeak,
                            overview: {},
                            airtable: {
                                H: normalizeAnyFieldValue(tempRecord['Event Category']) || normalizeAnyFieldValue(tempRecord['Channel']) || '',
                                I: normalizeAnyFieldValue(tempRecord['Country Available']) || '',
                                J: normalizeAnyFieldValue(tempRecord['Season']) || '',
                                K: normalizeAnyFieldValue(tempRecord['Phase ENG']) || '',
                                L: normalizeAnyFieldValue(tempRecord['Type of Event']) || '',
                                M_ARG: mArg,
                                M_CHI: mChi,
                                N: dur,
                                T: 'Available',
                                U: 'Available',
                                V: normalizeAnyFieldValue(tempRecord['Syndication']) || normalizeAnyFieldValue(tempRecord['PVC Synd Channel']) || '',
                                W: normalizeAnyFieldValue(tempRecord['Timeline Markers']) || normalizeAnyFieldValue(tempRecord['TLM']) || '',
                                X: normalizeAnyFieldValue(tempRecord['Dynamic Ad Insertion']) || normalizeAnyFieldValue(tempRecord['DAI?']) || ''
                            }
                        };
                        
                        console.log("📤 EMERGENCY: Payload enviado a Sheet:", JSON.stringify(payloadBundle, null, 2));
                        
                        const respFirst = await postToSheet(payloadBundle);
                        console.log("📥 EMERGENCY: Respuesta del Sheet:", respFirst);
                        if (respFirst?.ok) {
                            log("Sheet updated (FIRST write with emergency Airtable fetch).", respFirst);
                            const reg = await loadOnceRegistry();
                            reg[eventIdsKey] = { t: Date.now() };
                            await saveOnceRegistry(reg);
                            firstWriteDone = true;
                        } else {
                            console.error("Failed to update sheet (FIRST write with emergency fetch):", respFirst?.error || respFirst);
                        }
                        
                        // Marcar que ya encontramos datos de Airtable
                        airtableRecord = tempRecord;
                        airtableReady = true;
                        
                        firstWriteInProgress = false;
                        return;
                    } else {
                        console.log("❌ EMERGENCY: No se encontraron registros en Airtable o respuesta inválida");
                        console.log("📊 EMERGENCY: tempAirtableResp:", tempAirtableResp);
                    }
                }
            } catch (error) {
                console.error("❌ EMERGENCY: Error fetching Airtable data for first write:", error);
                console.log("📊 EMERGENCY: Estado actual - eventIds:", eventIds, "airtableRecord:", airtableRecord);
            }
            
            // Fallback: Solo enviar peak si no se pudieron obtener datos de Airtable
            const payloadSimple = {
                action: 'upsert_peak_by_id',
                event_id: eventIds[0],
                name: combinedEventName || '',
                peak: pagePeak
            };
            
            const respFirst = await postToSheet(payloadSimple);
            if (respFirst?.ok) {
                log("Sheet updated (FIRST write - peak only, no Airtable).", respFirst);
                const reg = await loadOnceRegistry();
                reg[eventIdsKey] = { t: Date.now() };
                await saveOnceRegistry(reg);
                firstWriteDone = true;
                
                // Programar backfill cuando llegue Airtable
                if (airtableFetchPromise && !firstBackfillDone) {
                    scheduleBackfill(primary);
                }
            } else {
                console.error("Failed to update sheet (FIRST write):", respFirst?.error || respFirst);
            }
        }
        
        firstWriteInProgress = false;
    }

    async function handleSubsequentWrite() {
        console.log("⚡ SUBSEQUENT WRITE: Verificando si tenemos datos de Airtable para M/N/O");
        console.log("⚡ SUBSEQUENT WRITE: airtableReady:", airtableReady, "airtableRecord existe:", !!airtableRecord);
        
        // Si tenemos datos de Airtable, usar upsert_bundle para incluir M/N/O
        if (airtableReady && airtableRecord) {
            // Obtener fechas usando la misma lógica que el botón Overview (sin normalización compleja)
            const mArg = normalizeAnyFieldValue(airtableRecord['ARG | Kick-off'] || 
                                              airtableRecord['ARG | K.O TIME VIEW'] || 
                                              airtableRecord['ARG | START TIME VIEW']);
            const mChi = normalizeAnyFieldValue(airtableRecord['CHI | Kick-off'] || 
                                               airtableRecord['CHI | START K.O VIEW'] || 
                                               airtableRecord['CHI | START TIME VIEW']);
            
            // Duración: manejar tanto el campo con typo como sin typo
            const durRaw = airtableRecord['Aprox Duration (h)'] ?? airtableRecord['Apox Duration (h)'];
            const dur = typeof durRaw === 'number' ? durRaw : (parseFloat(String(durRaw || '').replace(',', '.')) || '');
            
            console.log("🕒 SUBSEQUENT WRITE: Fechas obtenidas - ARG:", mArg, "CHI:", mChi, "DUR:", durRaw);
            console.log("🎯 SUBSEQUENT WRITE: Datos para M/N/O - M_ARG:", mArg, "M_CHI:", mChi, "N:", dur);
            
            // Usar upsert_bundle con datos completos
            const payloadBundle = {
                action: 'upsert_bundle',
                event_id: eventIds[0],
                name: combinedEventName || '',
                monitoring_peak: pagePeak,
                overview: {}, // Sin métricas de overview en subsecuentes
                airtable: {
                    H: normalizeAnyFieldValue(airtableRecord['Event Category']) || normalizeAnyFieldValue(airtableRecord['Channel']) || '',
                    I: normalizeAnyFieldValue(airtableRecord['Country Available']) || '',
                    J: normalizeAnyFieldValue(airtableRecord['Season']) || '',
                    K: normalizeAnyFieldValue(airtableRecord['Phase ENG']) || '',
                    L: normalizeAnyFieldValue(airtableRecord['Type of Event']) || '',
                    M_ARG: mArg,
                    M_CHI: mChi,
                    N: dur,
                    T: 'Available',
                    U: 'Available',
                    V: normalizeAnyFieldValue(airtableRecord['Syndication']) || normalizeAnyFieldValue(airtableRecord['PVC Synd Channel']) || '',
                    W: normalizeAnyFieldValue(airtableRecord['Timeline Markers']) || normalizeAnyFieldValue(airtableRecord['TLM']) || '',
                    X: normalizeAnyFieldValue(airtableRecord['Dynamic Ad Insertion']) || normalizeAnyFieldValue(airtableRecord['DAI?']) || ''
                }
            };
            
            console.log("📤 SUBSEQUENT WRITE: Payload completo enviado:", JSON.stringify(payloadBundle, null, 2));
            
            const respUp = await postToSheet(payloadBundle);
            console.log("📥 SUBSEQUENT WRITE: Respuesta del Sheet:", respUp);
            if (respUp?.ok) {
                log("Sheet updated (subsequent with M/N/O).", respUp);
            } else {
                console.error("Failed to update sheet (subsequent with M/N/O):", respUp?.error || respUp);
            }
        } else {
            // Fallback: Solo peak si no hay datos de Airtable
            console.log("❌ SUBSEQUENT WRITE: No hay datos de Airtable, enviando solo peak");
            const payloadUp = {
                action: 'upsert_peak_by_id',
                event_id: eventIds[0], // Apps Script espera un solo ID
                name: combinedEventName || '',
                peak: pagePeak
            };
            
            const respUp = await postToSheet(payloadUp);
            if (respUp?.ok) {
                log("Sheet updated (peak only).", respUp);
            } else {
                console.error("Failed to update sheet (peak only):", respUp?.error || respUp);
            }
        }
    }

    function scheduleBackfill(primary) {
        backfillScheduled = true;
        airtableFetchPromise.then(async (rec) => {
            if (rec && backfillScheduled && !firstBackfillDone) {
                try {
                    const paisBF = normalizeCountry(rec['Country Available']);
                    
                    // Preparar datos en el formato que espera el Apps Script con fechas normalizadas
                    const mArgRaw = rec['ARG | Kick-off'] || 
                                   rec['ARG | K.O TIME VIEW'] || 
                                   rec['ARG | START TIME VIEW'] || '';
                    const mChiRaw = rec['CHI | Kick-off'] || 
                                   rec['CHI | START K.O VIEW'] || 
                                   rec['CHI | START TIME VIEW'] || '';
                    
                    const mArg = normalizeDateFromAirtable(mArgRaw);
                    const mChi = normalizeDateFromAirtable(mChiRaw);
                    
                    const durRaw = rec['Aprox Duration (h)'] ?? rec['Apox Duration (h)'];
                    const dur = typeof durRaw === 'number' ? durRaw : (parseFloat(String(durRaw || '').replace(',', '.')) || '');
                    
                    log('Normalized dates for backfill:', { M_ARG: mArg, M_CHI: mChi, N: dur });
                    
                    // Usar la acción fill_airtable_fields_if_empty para el backfill
                    const payloadBF = {
                        action: 'fill_airtable_fields_if_empty',
                        event_id: eventIds[0],
                        H: normalizeAnyFieldValue(rec['Event Category']) || normalizeAnyFieldValue(rec['Channel']) || '',
                        I: paisBF,
                        J: normalizeAnyFieldValue(rec['Season']) || '',
                        K: normalizeAnyFieldValue(rec['Phase ENG']) || '',
                        L: normalizeAnyFieldValue(rec['Type of Event']) || '',
                        M_ARG: mArg,
                        M_CHI: mChi,
                        N: dur,
                        T: 'Available',
                        U: 'Available',
                        V: normalizeAnyFieldValue(rec['Syndication']) || normalizeAnyFieldValue(rec['PVC Synd Channel']) || '',
                        W: normalizeAnyFieldValue(rec['Timeline Markers']) || normalizeAnyFieldValue(rec['TLM']) || '',
                        X: normalizeAnyFieldValue(rec['Dynamic Ad Insertion']) || normalizeAnyFieldValue(rec['DAI?']) || ''
                    };
                    
                    const respBF = await postToSheet(payloadBF);
                    if (respBF?.ok) {
                        log("Sheet updated (BACKFILL Airtable).", respBF);
                        firstBackfillDone = true;
                        backfillScheduled = false;
                    } else {
                        console.error("Failed to backfill Airtable:", respBF?.error || respBF);
                    }
                } catch (error) { 
                    console.warn("Backfill error:", error); 
                }
            }
        });
    }

    // --- Utility Functions ---

    function convertToNumber(value, unit) {
        if (unit === 'k') return value * 1000;
        if (unit === 'M') return value * 1000000;
        return value;
    }

    function findPeakOnPage() {
        const container = document.querySelector('#main-content') || document.body;
        const allElements = Array.from(container.querySelectorAll('div, span, p'));
        const concurrentElements = allElements.filter(el => 
            (el.textContent || '').toLowerCase().includes('concurrent viewers')
        );
        
        let maxFound = 0;
        
        concurrentElements.forEach(el => {
            const candidates = [
                el.previousElementSibling, 
                el.nextElementSibling, 
                ...Array.from(el.children), 
                ...Array.from(el.parentElement?.children || [])
            ];
            
            candidates.forEach(node => {
                if (!node) return;
                const text = (node.textContent || '').trim();
                const match = text.match(/^(\d+(?:\.\d+)?)([kM]?)$/);
                if (match) {
                    const num = convertToNumber(parseFloat(match[1]), match[2]);
                    if (num > maxFound) maxFound = num;
                }
            });
        });
        
        return maxFound;
    }

    function updateTitle() {
        if (!isMonitoring) {
            document.title = "Mux Monitor (Idle)";
            return;
        }
        
        const displayPeak = Math.max(pagePeak, sheetPeak);
        const displayName = combinedEventName || `(${eventIds.length} ID(s))`;
        document.title = `PEAK: ${displayPeak} | ${displayName}`;
    }

    function normalizeCountry(value) {
        if (value == null) return "";
        if (Array.isArray(value)) {
            return value.map(v => (v == null ? "" : String(v))).filter(Boolean).join(", ");
        }
        return typeof value === "object" ? JSON.stringify(value) : String(value);
    }

    function buildNormalizedAirtableData(src, combinedEventName, eventIds) {
        const data = {};
        const source = src || {};
        
        // Campos básicos
        data['Event Name'] = source['Event Name'] || combinedEventName || '';
        data['Event Category'] = source['Event Category'] || '';
        data['Event Type'] = source['Event Type'] || '';
        data['Season'] = source['Season'] || '';
        data['Stage/instance'] = source['Stage/instance'] || source['Stage/intance'] || '';
        data['Kick OFF'] = source['Kick OFF'] || '';
        data['Home Competitor'] = source['Home Competitor'] || '';
        data['Away Competitor'] = source['Away Competitor'] || '';
        data['Syndication'] = source['Syndication'] || '';
        data['Dynamic Ad Insertion'] = source['Dynamic Ad Insertion'] || '';
        data['Timeline Markers'] = source['Timeline Markers'] || '';
        data['Fer Encoding'] = source['Fer Encoding'] || '';
        data['Highlights'] = source['Highlights'] || '';
        
        // País
        data['Country Available'] = source['Country Available'] || '';
        data['Pais'] = source['Pais'] || '';
        
        // Métricas Overview
        data['Views'] = source['Views'] || source['Total Views'] || '';
        data['Unique Viewers'] = source['Unique Viewers'] || source['Unique'] || '';
        data['Playback Failure Percentage'] = source['Playback Failure Percentage'] || 
                                              source['Playback Failure'] || 
                                              source['Playback Failure %'] || '';
        data['Video Startup Failure Percentage'] = source['Video Startup Failure Percentage'] || '';
        
        // Columnas M, N, O - Nuevos campos agregados
        // M: Kick-off (AR) - ARG | Kick-off, si está vacío usar CHI | Kick-off + 1 hora
        let kickoffAR = source['ARG | Kick-off'] || source['ARG | K.O TIME VIEW'] || '';
        if (!kickoffAR) {
            const kickoffCHI = source['CHI | START K.O VIEW'] || '';
            if (kickoffCHI) {
                kickoffAR = addOneHourToTime(kickoffCHI);
            }
        }
        data['Kick-off (AR)'] = kickoffAR;
        
        // N: Aprox Duration (h) - formato decimal (ej: 2.25 = 2h 15min)
        data['Aprox Duration (h)'] = source['Aprox Duration (h)'] || source['Duration (minutes)'] || '';
        
        // O: Event End = M + N (Kick-off + Duration)
        data['Event End'] = calculateEventEnd(kickoffAR, data['Aprox Duration (h)']);
        
        return data;
    }

    // Función auxiliar para sumar 1 hora a un tiempo
    function addOneHourToTime(timeString) {
        if (!timeString) return '';
        try {
            // Intentar parsear diferentes formatos de fecha/hora
            let date = new Date(timeString);
            if (isNaN(date.getTime())) {
                // Intentar formato ISO
                date = new Date(timeString.replace(/\s+/g, 'T'));
            }
            if (isNaN(date.getTime())) return timeString; // Si no se puede parsear, devolver original
            
            date.setHours(date.getHours() + 1);
            return date.toISOString().slice(0, 19).replace('T', ' ');
        } catch (error) {
            console.warn('Error adding one hour to time:', error);
            return timeString;
        }
    }

    // Función auxiliar para calcular Event End (M + N)
    function calculateEventEnd(kickoffTime, durationHours) {
        if (!kickoffTime || !durationHours) return '';
        try {
            let date = new Date(kickoffTime);
            if (isNaN(date.getTime())) {
                date = new Date(kickoffTime.replace(/\s+/g, 'T'));
            }
            if (isNaN(date.getTime())) return '';
            
            const duration = parseFloat(durationHours);
            if (isNaN(duration)) return '';
            
            // Agregar las horas de duración
            const totalMinutes = Math.round(duration * 60);
            date.setMinutes(date.getMinutes() + totalMinutes);
            
            return date.toISOString().slice(0, 19).replace('T', ' ');
        } catch (error) {
            console.warn('Error calculating event end:', error);
            return '';
        }
    }

    // --- Storage Functions ---
    
    function loadOnceRegistry() {
        return new Promise((resolve) => {
            chrome.storage.local.get([ONCE_KEY], (data) => {
                const registry = (data && data[ONCE_KEY]) ? data[ONCE_KEY] : {};
                const now = Date.now();
                const oneWeekMs = 7 * 24 * 3600 * 1000;
                
                // Limpiar entradas antiguas (más de 1 semana)
                for (const key of Object.keys(registry)) {
                    if (!registry[key]?.t || (now - registry[key].t > oneWeekMs)) {
                        delete registry[key];
                    }
                }
                
                resolve(registry);
            });
        });
    }

    function saveOnceRegistry(registry) {
        return new Promise((resolve) => {
            const payload = {};
            payload[ONCE_KEY] = registry;
            chrome.storage.local.set(payload, () => resolve());
        });
    }

    function loadBasicRegistry() {
        return new Promise((resolve) => {
            chrome.storage.local.get([BASIC_KEY], (data) => {
                resolve((data && data[BASIC_KEY]) ? data[BASIC_KEY] : {});
            });
        });
    }

    function saveBasicRegistry(registry) {
        return new Promise((resolve) => {
            const payload = {};
            payload[BASIC_KEY] = registry;
            chrome.storage.local.set(payload, () => resolve());
        });
    }

    // --- Airtable Integration Functions ---
    
    async function fetchFieldByIdFromAirtable(videoId, fieldId) {
        try {
            // Intento 1: búsqueda exacta
            const exactParams = new URLSearchParams({
                filterByFormula: `={${AIRTABLE_CONFIG.FIELDS.STREAM}}="${videoId}"`,
                pageSize: "1",
                returnFieldsByFieldId: "true"
            });
            
            let response = await fetch(`${AIRTABLE_URL}?${exactParams}`, {
                headers: { Authorization: `Bearer ${AIRTABLE_CONFIG.TOKEN}` }
            });
            
            if (response?.ok) {
                const json = await response.json();
                if (json.records?.length) {
                    const value = json.records[0]?.fields?.[fieldId];
                    return normalizeAnyFieldValue(value);
                }
            }

            // Intento 2: búsqueda con FIND
            const findParams = new URLSearchParams({
                filterByFormula: `FIND("${videoId}", {${AIRTABLE_CONFIG.FIELDS.STREAM}})`,
                pageSize: "1",
                returnFieldsByFieldId: "true"
            });
            
            response = await fetch(`${AIRTABLE_URL}?${findParams}`, {
                headers: { Authorization: `Bearer ${AIRTABLE_CONFIG.TOKEN}` }
            });
            
            if (response?.ok) {
                const json = await response.json();
                return normalizeAnyFieldValue(json.records?.[0]?.fields?.[fieldId]);
            }
        } catch (error) {
            console.warn(`Error fetching field ${fieldId} for video ${videoId}:`, error);
        }
        
        return "";
    }

    function normalizeAnyFieldValue(value) {
        if (value == null) return "";
        
        if (Array.isArray(value)) {
            const isSimpleArray = value.every(item => 
                ["string", "number", "boolean"].includes(typeof item) || item == null
            );
            return isSimpleArray 
                ? value.map(item => item == null ? "" : String(item)).join(", ")
                : JSON.stringify(value);
        }
        
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
    }

    async function fetchPrimaryAirtableFieldsForIds(ids) {
        const result = {};
        const idList = Array.isArray(ids) ? ids : [ids];
        
        for (const id of idList) {
            const fieldPromises = [
                { key: 'Stage/instance', field: AIRTABLE_CONFIG.FIELDS.STAGE },
                { key: 'Kick OFF', field: AIRTABLE_CONFIG.FIELDS.START_TIME },
                { key: 'Season', field: AIRTABLE_CONFIG.FIELDS.SEASON },
                { key: 'Event Name', field: AIRTABLE_CONFIG.FIELDS.EVENT_NAME },
                { key: 'Event Category', field: AIRTABLE_CONFIG.FIELDS.EVENT_CATEGORY },
                { key: 'Event Type', field: AIRTABLE_CONFIG.FIELDS.EVENT_TYPE },
                { key: 'Dynamic Ad Insertion', field: AIRTABLE_CONFIG.FIELDS.DAI },
                { key: 'Timeline Markers', field: AIRTABLE_CONFIG.FIELDS.TLM },
                { key: 'Syndication', field: AIRTABLE_CONFIG.FIELDS.SYNDICATION }
            ];

            for (const { key, field } of fieldPromises) {
                if (!result[key]) {
                    const value = await fetchFieldByIdFromAirtable(id, field);
                    if (value) result[key] = value;
                }
            }
        }
        
        return result;
    }

    // --- Sheet Integration Functions ---
    
    async function maybeFillAirtableHK() {
        if (initialAirtableFillDone) return;
        
        const primaryId = Array.isArray(eventIds) && eventIds.length ? eventIds[0] : '';
        if (!primaryId) { 
            initialAirtableFillDone = true; 
            return; 
        }

        const channel = normalizeAnyFieldValue(airtableRecord['Channel']);
        const countryAvailable = normalizeAnyFieldValue(airtableRecord['Country Available']);
        const season = normalizeAnyFieldValue(airtableRecord['Season']);
        const phase = normalizeAnyFieldValue(airtableRecord['Phase ENG']);

        const payload = {
            action: 'fill_airtable_fields_if_empty',
            event_id: primaryId,
            H: channel,
            I: countryAvailable,
            J: season,
            K: phase
        };
        
        const response = await postToSheet(payload);
        if (response?.ok) {
            log('Filled H/I/J/K if empty', { 
                event: primaryId, 
                H: channel, 
                I: countryAvailable, 
                J: season, 
                K: phase 
            });
        } else {
            console.warn('Failed to fill H/I/J/K:', response?.error || response);
        }
        
        initialAirtableFillDone = true;
    }

    async function ensurePeakConsistency(candidatePeak) {
        try {
            const primaryId = Array.isArray(eventIds) && eventIds.length ? eventIds[0] : '';
            if (!primaryId) return { decidedPeak: candidatePeak, source: 'page' };

            // 1) Leer peak del Sheet (col C) para ese Video ID
            let sheetValue = 0;
            try {
                const response = await getFromSheet(primaryId);
                if (response?.ok && response.peak != null) {
                    sheetValue = Number(response.peak) || 0;
                }
            } catch (error) {
                console.warn("Error getting sheet peak:", error);
            }

            if (sheetValue > candidatePeak) {
                // 2) Si el sheet es mayor, usar el del Sheet y NO escribir
                return { decidedPeak: sheetValue, source: 'sheet' };
            }

            if (candidatePeak > sheetValue) {
                // 3) Si el de la página es mayor, hacer upsert A/B/C en la hoja 'MUX'
                try {
                    const name = combinedEventName || '';
                    await postToSheet({
                        action: 'upsert_peak_by_id',
                        event_id: primaryId,
                        name,
                        peak: candidatePeak
                    });
                } catch (error) {
                    console.warn("Error upserting peak:", error);
                }
                return { decidedPeak: candidatePeak, source: 'page' };
            }

            // 4) Iguales: no hacer nada especial
            return { decidedPeak: candidatePeak, source: 'equal' };
        } catch (error) {
            console.warn("Error in peak consistency check:", error);
            return { decidedPeak: candidatePeak, source: 'page' };
        }
    }

    async function maybeAppendBasicRow() {
        // Requiere tener nombre listo para no enviar filas incompletas
        if (!combinedEventName) return;
        
        const key = eventIdsKey || (eventIds && eventIds.join(', ')) || '';
        if (!key) return;

        const registry = await loadBasicRegistry();
        const lastPeak = Number(registry[key] || 0);
        if (Number(pagePeak) <= lastPeak) return; // ya escribimos este o un peak mayor

        const videoIdText = (eventIds && eventIds.length) ? eventIds[0] : ''; // Solo el primer ID
        const payload = {
            action: 'append_video_peak_row',
            row: {
                a: videoIdText,
                b: combinedEventName || '',
                c: pagePeak
            }
        };
        
        const response = await postToSheet(payload);
        if (response?.ok) {
            registry[key] = pagePeak;
            await saveBasicRegistry(registry);
            log("Basic row appended A/B/C", payload.row);
        } else {
            console.warn("Failed to append basic row:", response?.error || response);
        }
    }

    // --- Sheet Communication Functions ---
    
    async function postToSheet(payload) {
        return new Promise((resolve) => {
            log("Posting to sheet:", payload);
            
            chrome.runtime.sendMessage(
                { action: "postToSheet", url: SHEET_API_URL, payload },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("Error posting to sheet:", chrome.runtime.lastError.message);
                        resolve({ ok: false, error: chrome.runtime.lastError.message });
                    } else {
                        log("Sheet response:", response);
                        resolve(response || { ok: false, error: "no response" });
                    }
                }
            );
        });
    }

    async function getFromSheet(eventId) {
        return new Promise((resolve) => {
            const url = new URL(SHEET_API_URL);
            url.searchParams.set('action', 'get_peak');
            url.searchParams.set('event_id', eventId);
            
            chrome.runtime.sendMessage(
                { action: "getFromSheet", url: url.toString() },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Error getting from sheet:", chrome.runtime.lastError.message);
                        resolve({ ok: false, error: chrome.runtime.lastError.message });
                    } else {
                        resolve(response || { ok: false, error: "no response" });
                    }
                }
            );
        });
    }

    // --- Initialization ---
    initialize();

})();

// =====================================================
// ✅ FLOATING PILL COMPONENT (Integrated Version)
// Se inicia solo cuando es llamado por el script principal.
// =====================================================

function initializeFloatingPill() {
    // Guard Clause: No hacer nada si no estamos en la página de monitoreo
    if (!window.location.href.includes('/monitoring')) {
        return;
    }

    const PILL_ID = 'mux-monitor-pill';
    const STORAGE_KEY = 'muxMonitorPillPosition';
    let pillElement = document.getElementById(PILL_ID);

    // Si el cartel ya existe, no hacer nada más
    if (pillElement) return;

    function createPillElement() {
        const pill = document.createElement('div');
        pill.id = PILL_ID;

        Object.assign(pill.style, {
            position: 'fixed',
            top: '16px',
            left: '16px',
            backgroundColor: '#1565c0',
            color: 'white',
            padding: '8px 16px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            zIndex: '99999',
            fontFamily: 'sans-serif',
            fontSize: '14px',
            lineHeight: '1.4',
            cursor: 'move',
            userSelect: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
        });

        pill.innerHTML = `
            <div class="mux-pill-peak" style="font-weight: bold;">Peak: -</div>
            <div class="mux-pill-name" style="font-style: italic;">-</div>
        `;

        document.body.appendChild(pill);
        return pill;
    }

    function makeDraggable(element, onDragEnd = () => {}) {
        let offsetX, offsetY, isDragging = false;
        
        element.addEventListener('mousedown', (e) => {
            isDragging = true;
            offsetX = e.clientX - element.getBoundingClientRect().left;
            offsetY = e.clientY - element.getBoundingClientRect().top;
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const newX = e.clientX - offsetX;
            const newY = e.clientY - offsetY;
            element.style.left = `${newX}px`;
            element.style.top = `${newY}px`;
        });
        
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                onDragEnd({ x: element.style.left, y: element.style.top });
            }
        });
    }

    function updatePillContent() {
        if (!pillElement) return;
        
        const peakElement = pillElement.querySelector('.mux-pill-peak');
        const nameElement = pillElement.querySelector('.mux-pill-name');
        const title = document.title;
        
        let peakText = 'Peak: -';
        let eventName = '-';

        const idRegex = /filters%5B\d*%5D=video_id%3A([^&]+)/g;
        const idMatches = window.location.href.match(idRegex) || [];
        
        if (idMatches.length > 1) {
            eventName = 'Varios EventID';
        }

        const titleMatch = title.match(/PEAK: ([\d,.]+) \| (.*)/);
        if (titleMatch) {
            peakText = `Peak: ${titleMatch[1]}`;
            if (eventName === '-') {
                const rawName = titleMatch[2].trim();
                eventName = rawName.includes('ID(s))') ? 'Varios EventID' : rawName;
            }
        } else if (title.includes('ID(s))') && eventName === '-') {
            eventName = 'Varios EventID';
        }
        
        peakElement.textContent = peakText;
        nameElement.textContent = eventName;
    }

    function savePosition(position) {
        chrome.storage.local.set({ [STORAGE_KEY]: position });
    }

    function loadAndApplyPosition() {
        chrome.storage.local.get(STORAGE_KEY, (result) => {
            if (result[STORAGE_KEY] && pillElement) {
                pillElement.style.left = result[STORAGE_KEY].x;
                pillElement.style.top = result[STORAGE_KEY].y;
                
                // Validar que el elemento esté visible en pantalla
                requestAnimationFrame(() => {
                    if (!pillElement) return;
                    
                    const rect = pillElement.getBoundingClientRect();
                    const viewportWidth = window.innerWidth;
                    const viewportHeight = window.innerHeight;
                    
                    const isOutOfBounds = rect.right < 0 || 
                                         rect.left > viewportWidth || 
                                         rect.bottom < 0 || 
                                         rect.top > viewportHeight;
                    
                    if (isOutOfBounds) {
                        pillElement.style.left = '16px';
                        pillElement.style.top = '16px';
                        const defaultPosition = { x: '16px', y: '16px' };
                        chrome.storage.local.set({ [STORAGE_KEY]: defaultPosition });
                    }
                });
            }
        });
    }

    // Initialize floating pill
    pillElement = createPillElement();
    loadAndApplyPosition();
    makeDraggable(pillElement, savePosition);
    updatePillContent();

    // Observer for title changes
    const titleObserver = new MutationObserver(updatePillContent);
    const titleElement = document.querySelector('title');
    if (titleElement) {
        titleObserver.observe(titleElement, { childList: true });
    }
}