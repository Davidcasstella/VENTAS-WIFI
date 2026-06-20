const accessManagerService = require('./accessManager.service');

/**
 * CronRevokeService
 *
 * Periodically checks for expired access records and automatically
 * revokes Google Drive permissions. Runs every hour by default.
 */
class CronRevokeService {

    constructor() {
        this._interval = null;
        this._running = false;
        this._lastRun = null;
        this._lastResult = null;
    }

    /**
     * Start the scheduler. Runs every hour (configurable via env).
     */
    startScheduler() {
        if (this._interval) {
            console.log('⏰ [CronRevoke] Scheduler already running');
            return;
        }

        const intervalMs = parseInt(process.env.GOOGLE_DRIVE_REVOKE_INTERVAL_MS || '3600000', 10); // Default: 1 hour
        const intervalMin = Math.round(intervalMs / 60000);

        console.log(`⏰ [CronRevoke] Scheduler started — checking every ${intervalMin} minutes`);

        // Run once at startup (after a short delay to let Drive init)
        setTimeout(() => this._runCheck(), 10000);

        // Then run periodically
        this._interval = setInterval(() => this._runCheck(), intervalMs);
    }

    /**
     * Stop the scheduler.
     */
    stopScheduler() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
            console.log('⏰ [CronRevoke] Scheduler stopped');
        }
    }

    /**
     * Run the expiry check.
     */
    async _runCheck() {
        if (this._running) {
            console.log('⏰ [CronRevoke] Check already in progress, skipping');
            return;
        }

        this._running = true;
        this._lastRun = new Date().toISOString();

        try {
            const revokedCount = await accessManagerService.revokeExpiredAccesses();
            this._lastResult = {
                success: true,
                revokedCount,
                timestamp: this._lastRun,
            };

            if (revokedCount > 0) {
                console.log(`⏰ [CronRevoke] Check complete — ${revokedCount} access(es) revoked`);
            }
        } catch (err) {
            this._lastResult = {
                success: false,
                error: err.message,
                timestamp: this._lastRun,
            };
            console.error(`❌ [CronRevoke] Check failed: ${err.message}`);
        } finally {
            this._running = false;
        }
    }

    /**
     * Get scheduler status.
     */
    getStatus() {
        return {
            running: !!this._interval,
            lastRun: this._lastRun,
            lastResult: this._lastResult,
        };
    }

    /**
     * Manually trigger a check (from dashboard).
     */
    async triggerCheck() {
        await this._runCheck();
        return this._lastResult;
    }
}

module.exports = new CronRevokeService();
