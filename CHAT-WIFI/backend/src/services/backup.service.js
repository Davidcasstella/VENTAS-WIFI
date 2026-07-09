const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const googleDriveService = require('./googleDrive.service');

const DATA_DIR = path.join(__dirname, '../../data');
const PUBLIC_DIR = path.join(__dirname, '../../public');
const SESSION_DIR = path.join(__dirname, '../../session');
const BACKUPS_TEMP_DIR = path.join(__dirname, '../../backups-temp');

const BACKUP_FOLDER_NAME = process.env.BACKUP_FOLDER_NAME || 'ChatWifi-Backups';
const RETAIN_BACKUPS_COUNT = parseInt(process.env.RETAIN_BACKUPS_COUNT || '7', 10);

class BackupService {
    constructor() {
        fs.ensureDirSync(BACKUPS_TEMP_DIR);
    }

    /**
     * Comprime las carpetas seleccionadas en un ZIP local.
     */
    async _createZip(zipPath) {
        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', () => {
                console.log(`📦 [Backup] ZIP creado exitosamente: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
                resolve(zipPath);
            });

            archive.on('error', (err) => {
                reject(err);
            });

            archive.pipe(output);

            // Add media folder
            const mediaDir = path.join(DATA_DIR, 'media');
            if (fs.existsSync(mediaDir)) {
                archive.directory(mediaDir, 'data/media');
            }
            
            // Add media.db
            const mediaDb = path.join(DATA_DIR, 'media.db');
            if (fs.existsSync(mediaDb)) {
                archive.file(mediaDb, { name: 'data/media.db' });
            }

            // Add public uploads
            const uploadsDir = path.join(PUBLIC_DIR, 'uploads');
            if (fs.existsSync(uploadsDir)) {
                archive.directory(uploadsDir, 'public/uploads');
            }

            // Add session
            if (fs.existsSync(SESSION_DIR)) {
                archive.directory(SESSION_DIR, 'session');
            }

            archive.finalize();
        });
    }

    /**
     * Limpia los backups antiguos en Google Drive, manteniendo sólo los últimos N.
     */
    async _cleanupOldBackups(folderId) {
        if (RETAIN_BACKUPS_COUNT <= 0) return; // Keep all

        try {
            const files = await googleDriveService.listFilesInFolder(folderId);
            
            if (files.length > RETAIN_BACKUPS_COUNT) {
                const filesToDelete = files.slice(RETAIN_BACKUPS_COUNT);
                console.log(`🗑️ [Backup] Eliminando ${filesToDelete.length} backups antiguos en Drive...`);
                
                for (const file of filesToDelete) {
                    await googleDriveService.deleteFile(file.id);
                }
            }
        } catch (err) {
            console.error('⚠️ [Backup] Error limpiando backups antiguos:', err.message);
        }
    }

    /**
     * Ejecuta el proceso de backup completo.
     */
    async runBackup() {
        console.log('🔄 [Backup] Iniciando proceso de copia de seguridad...');
        let zipPath = null;
        
        try {
            // 1. Verificar conexión a Drive y buscar/crear carpeta
            const status = await googleDriveService.getStatus();
            if (!status.connected) {
                throw new Error('Google Drive no está conectado. No se puede realizar el backup.');
            }

            let folder = await googleDriveService.findFolderByName(BACKUP_FOLDER_NAME);
            if (!folder) {
                console.log(`📁 [Backup] Creando carpeta "${BACKUP_FOLDER_NAME}" en Google Drive...`);
                folder = await googleDriveService.createFolder(BACKUP_FOLDER_NAME);
            }

            // 2. Crear ZIP temporal
            const dateStr = new Date().toISOString().split('T')[0];
            const zipName = `backup-${dateStr}-${Date.now()}.zip`;
            zipPath = path.join(BACKUPS_TEMP_DIR, zipName);
            
            await this._createZip(zipPath);

            // 3. Subir a Google Drive
            console.log(`☁️ [Backup] Subiendo ${zipName} a Google Drive...`);
            await googleDriveService.uploadFile(zipPath, zipName, 'application/zip', folder.id);

            // 4. Limpiar local
            fs.unlinkSync(zipPath);
            zipPath = null;

            // 5. Limpiar backups antiguos en Drive
            await this._cleanupOldBackups(folder.id);

            console.log('✅ [Backup] Copia de seguridad completada con éxito.');
            return true;
        } catch (err) {
            console.error('❌ [Backup] Falló la copia de seguridad:', err.message);
            if (zipPath && fs.existsSync(zipPath)) {
                try { fs.unlinkSync(zipPath); } catch (e) {}
            }
            return false;
        }
    }
}

module.exports = new BackupService();
