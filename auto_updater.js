// auto_updater.js - Sistema de auto-actualización
class MuxBotAutoUpdater {
    constructor() {
        this.GITHUB_USER = 'Alemarval33';           // Usuario de GitHub
        this.GITHUB_REPO = 'Extension-WBD';        // Repositorio
        this.UPDATE_CHECK_KEY = 'muxbot_last_update_check';
        this.PENDING_UPDATE_KEY = 'muxbot_pending_update';
        this.CURRENT_VERSION = chrome.runtime.getManifest().version;
        
        this.init();
    }
    
    async init() {
        // Chequear al iniciar y luego cada 24 horas
        await this.checkForUpdatesIfNeeded();
        this.schedulePeriodicChecks();
    }
    
    async checkForUpdatesIfNeeded() {
        const lastCheck = await this.getLastUpdateCheck();
        const now = Date.now();
        const dayInMs = 24 * 60 * 60 * 1000;
        
        // Solo chequear una vez por día
        if (!lastCheck || (now - lastCheck) > dayInMs) {
            console.log('[AutoUpdater] Checking for updates...');
            await this.checkForUpdates();
            await this.setLastUpdateCheck(now);
        }
    }
    
    async checkForUpdates() {
        try {
            // 1. Obtener la última release de GitHub
            const releaseInfo = await this.getLatestRelease();
            
            if (!releaseInfo) {
                console.log('[AutoUpdater] No releases found');
                return;
            }
            
            // 2. Comparar versiones
            if (this.isNewerVersion(releaseInfo.tag_name, this.CURRENT_VERSION)) {
                console.log(`[AutoUpdater] New version available: ${releaseInfo.tag_name}`);
                
                // 3. Descargar automáticamente la actualización
                const downloadSuccess = await this.downloadUpdate(releaseInfo);
                
                if (downloadSuccess) {
                    // 4. Notificar al usuario
                    await this.notifyUserOfUpdate(releaseInfo);
                }
            } else {
                console.log('[AutoUpdater] Extension is up to date');
            }
            
        } catch (error) {
            console.warn('[AutoUpdater] Update check failed:', error);
        }
    }
    
    async getLatestRelease() {
        const url = `https://api.github.com/repos/${this.GITHUB_USER}/${this.GITHUB_REPO}/releases/latest`;
        
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            return await response.json();
        } catch (error) {
            console.warn('[AutoUpdater] Failed to fetch release info:', error);
            return null;
        }
    }
    
    isNewerVersion(remoteVersion, localVersion) {
        // Remover 'v' del inicio si existe
        const remote = remoteVersion.replace(/^v/, '').split('.').map(Number);
        const local = localVersion.replace(/^v/, '').split('.').map(Number);
        
        // Comparar major.minor.patch
        for (let i = 0; i < Math.max(remote.length, local.length); i++) {
            const r = remote[i] || 0;
            const l = local[i] || 0;
            
            if (r > l) return true;
            if (r < l) return false;
        }
        
        return false;
    }
    
    async downloadUpdate(releaseInfo) {
        try {
            // Buscar el asset ZIP
            const zipAsset = releaseInfo.assets.find(asset => 
                asset.name.toLowerCase().includes('.zip')
            );
            
            if (!zipAsset) {
                console.warn('[AutoUpdater] No ZIP asset found in release');
                return false;
            }
            
            console.log(`[AutoUpdater] Downloading update: ${zipAsset.name}`);
            
            // Descargar usando Chrome Downloads API
            const downloadId = await new Promise((resolve, reject) => {
                chrome.downloads.download({
                    url: zipAsset.browser_download_url,
                    filename: `muxbot-update-${releaseInfo.tag_name}.zip`,
                    saveAs: false
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(downloadId);
                    }
                });
            });
            
            // Esperar a que termine la descarga
            return await this.waitForDownload(downloadId, releaseInfo);
            
        } catch (error) {
            console.error('[AutoUpdater] Download failed:', error);
            return false;
        }
    }
    
    async waitForDownload(downloadId, releaseInfo) {
        return new Promise((resolve) => {
            const checkDownload = () => {
                chrome.downloads.search({id: downloadId}, (downloads) => {
                    if (downloads.length > 0) {
                        const download = downloads[0];
                        
                        if (download.state === 'complete') {
                            console.log('[AutoUpdater] Download completed:', download.filename);
                            this.storePendingUpdate(releaseInfo, download.filename);
                            resolve(true);
                        } else if (download.state === 'interrupted') {
                            console.error('[AutoUpdater] Download interrupted');
                            resolve(false);
                        } else {
                            // Aún descargando, chequear de nuevo en 1 segundo
                            setTimeout(checkDownload, 1000);
                        }
                    } else {
                        resolve(false);
                    }
                });
            };
            
            checkDownload();
        });
    }
    
    async storePendingUpdate(releaseInfo, filename) {
        const updateInfo = {
            version: releaseInfo.tag_name,
            filename: filename,
            changelog: releaseInfo.body,
            downloadedAt: Date.now()
        };
        
        await chrome.storage.local.set({[this.PENDING_UPDATE_KEY]: updateInfo});
    }
    
    async notifyUserOfUpdate(releaseInfo) {
        // Crear notificación
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: 'MuxBot - Actualización Disponible',
            message: `Nueva versión ${releaseInfo.tag_name} descargada. Haz clic en el ícono de MuxBot para instalar.`
        });
        
        // Badge en el ícono de la extensión
        chrome.action.setBadgeText({text: '●'});
        chrome.action.setBadgeBackgroundColor({color: '#4CAF50'});
    }
    
    async getPendingUpdate() {
        const result = await chrome.storage.local.get([this.PENDING_UPDATE_KEY]);
        return result[this.PENDING_UPDATE_KEY] || null;
    }
    
    async clearPendingUpdate() {
        await chrome.storage.local.remove([this.PENDING_UPDATE_KEY]);
        chrome.action.setBadgeText({text: ''});
    }
    
    async getLastUpdateCheck() {
        const result = await chrome.storage.local.get([this.UPDATE_CHECK_KEY]);
        return result[this.UPDATE_CHECK_KEY] || null;
    }
    
    async setLastUpdateCheck(timestamp) {
        await chrome.storage.local.set({[this.UPDATE_CHECK_KEY]: timestamp});
    }
    
    schedulePeriodicChecks() {
        // Chequear cada 4 horas mientras la extensión esté activa
        setInterval(() => {
            this.checkForUpdatesIfNeeded();
        }, 4 * 60 * 60 * 1000);
    }
    
    // Método público para forzar check manual
    async forceUpdateCheck() {
        await this.checkForUpdates();
    }
}

// Exportar para uso en background.js
if (typeof module !== 'undefined') {
    module.exports = MuxBotAutoUpdater;
}