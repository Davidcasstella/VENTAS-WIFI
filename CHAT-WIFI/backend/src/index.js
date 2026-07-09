const { server } = require('./app');
const whatsapp = require('./core/WhatsApp');
const config = require('./config');
const cronJobs = require('./services/cronJobs.service');

async function start() {
    try {
        console.log('🚀 Iniciando Chat WiFi...');

        // 1. Iniciar Motor de WhatsApp
        await whatsapp.init();

        // 2. Iniciar Tareas Programadas (Backups, etc)
        cronJobs.start();

        // 3. Iniciar Servidor HTTP
        server.listen(config.port, () => {
            console.log(`\n✅ Servidor en ejecución: http://localhost:${config.port}`);
            console.log(`📡 Entorno: ${config.env}\n`);
        });

    } catch (error) {
        console.error('❌ Error fatal al iniciar:', error);
        process.exit(1);
    }
}

start();

// Manejo de errores globales
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown:', err);
});
