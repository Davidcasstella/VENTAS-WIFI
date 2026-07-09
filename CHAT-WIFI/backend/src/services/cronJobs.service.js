const cron = require('node-cron');
const backupService = require('./backup.service');
const accessManagerService = require('./accessManager.service');

class CronJobsService {
    constructor() {
        this.backupJob = null;
        this.accessRevokeJob = null;
    }

    start() {
        console.log('⏰ [CronJobs] Inicializando tareas programadas...');

        // 1. Tarea de Backup a Google Drive (Todos los días a las 3:00 AM)
        const backupTime = process.env.BACKUP_CRON_EXPRESSION || '0 3 * * *';
        this.backupJob = cron.schedule(backupTime, async () => {
            console.log(`⏰ [CronJobs] Ejecutando tarea programada: Backup (Hora: ${new Date().toLocaleString()})`);
            await backupService.runBackup();
        }, {
            scheduled: true,
            timezone: process.env.TIMEZONE || 'America/Bogota'
        });

        // 2. Tarea para Revocar Accesos Expirados (Todos los días a las 4:00 AM)
        const revokeTime = process.env.REVOKE_CRON_EXPRESSION || '0 4 * * *';
        this.accessRevokeJob = cron.schedule(revokeTime, async () => {
            console.log(`⏰ [CronJobs] Ejecutando tarea programada: Revocación de Accesos (Hora: ${new Date().toLocaleString()})`);
            try {
                await accessManagerService.revokeExpiredAccesses();
            } catch (err) {
                console.error('❌ [CronJobs] Error al revocar accesos:', err.message);
            }
        }, {
            scheduled: true,
            timezone: process.env.TIMEZONE || 'America/Bogota'
        });

        console.log('✅ [CronJobs] Tareas programadas iniciadas con éxito.');
    }

    stop() {
        if (this.backupJob) this.backupJob.stop();
        if (this.accessRevokeJob) this.accessRevokeJob.stop();
        console.log('🛑 [CronJobs] Tareas programadas detenidas.');
    }
}

module.exports = new CronJobsService();
