#!/bin/bash
# ============================================================
# backup.sh — ChatWiFi Data Backup
# Run this BEFORE stopping or updating the EC2 instance.
# Saves all messages, user states, and media files.
# ============================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Paths
REPO_DIR="$HOME/VENTAS-WIFI/CHAT-WIFI"
DATA_DIR="$REPO_DIR/backend/data"
BACKUP_ROOT="$HOME/wifi-backups"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     ChatWiFi — Backup de Datos           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# 1. Verify data directory exists
if [ ! -d "$DATA_DIR" ]; then
    echo -e "${RED}❌ No se encontró la carpeta de datos: $DATA_DIR${NC}"
    exit 1
fi

# 2. Create backup folder
mkdir -p "$BACKUP_DIR"
echo -e "${YELLOW}📁 Carpeta de backup: $BACKUP_DIR${NC}"
echo ""

# 3. Backup JSON files (messages, user states, config)
echo -e "${BLUE}💬 Guardando mensajes y configuración...${NC}"
JSON_FILES=(
    "chat-history.json"
    "welcome-user-states.json"
    "welcome-automation.json"
    "blocked-numbers.json"
    "follow-up-config.json"
    "follow-up-states.json"
    "ai-automations.json"
    "ai-fallback.json"
    "bot-config.json"
)

for file in "${JSON_FILES[@]}"; do
    if [ -f "$DATA_DIR/$file" ]; then
        cp "$DATA_DIR/$file" "$BACKUP_DIR/$file"
        SIZE=$(du -sh "$DATA_DIR/$file" | cut -f1)
        echo -e "   ✅ $file (${SIZE})"
    else
        echo -e "   ⚠️  $file no existe (se omite)"
    fi
done

# 4. Backup SQLite media database
echo ""
echo -e "${BLUE}🗄️  Guardando base de datos de media...${NC}"
if [ -f "$DATA_DIR/media.db" ]; then
    cp "$DATA_DIR/media.db" "$BACKUP_DIR/media.db"
    SIZE=$(du -sh "$DATA_DIR/media.db" | cut -f1)
    echo -e "   ✅ media.db (${SIZE})"
fi

# 5. Backup media files (photos, audio, video)
echo ""
echo -e "${BLUE}📸🎵 Guardando archivos de media (fotos/audios/videos)...${NC}"
if [ -d "$DATA_DIR/media" ]; then
    cp -r "$DATA_DIR/media" "$BACKUP_DIR/media"
    MEDIA_SIZE=$(du -sh "$DATA_DIR/media" | cut -f1)
    MEDIA_COUNT=$(find "$DATA_DIR/media" -type f | wc -l)
    echo -e "   ✅ $MEDIA_COUNT archivos de media (${MEDIA_SIZE})"
else
    echo -e "   ⚠️  Carpeta media no existe (se omite)"
fi

# 6. Create a compressed archive for easy transfer
echo ""
echo -e "${BLUE}🗜️  Comprimiendo backup...${NC}"
cd "$BACKUP_ROOT"
tar -czf "${TIMESTAMP}.tar.gz" "$TIMESTAMP/"
ARCHIVE_SIZE=$(du -sh "${TIMESTAMP}.tar.gz" | cut -f1)
echo -e "   ✅ Archivo: $BACKUP_ROOT/${TIMESTAMP}.tar.gz (${ARCHIVE_SIZE})"

# 7. Keep only the last 5 backups (cleanup old ones)
echo ""
echo -e "${BLUE}🧹 Limpiando backups antiguos (guardando últimos 5)...${NC}"
# Remove old uncompressed backup dirs
ls -dt "$BACKUP_ROOT"/[0-9]*/ 2>/dev/null | tail -n +6 | xargs rm -rf 2>/dev/null
# Remove old .tar.gz files keeping last 5
ls -t "$BACKUP_ROOT"/*.tar.gz 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null
echo -e "   ✅ Limpieza completada"

# 8. Show summary
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         ✅ BACKUP COMPLETADO             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "📦 Ubicación:  ${YELLOW}$BACKUP_ROOT/${TIMESTAMP}.tar.gz${NC}"
echo -e "⏰ Timestamp:  ${TIMESTAMP}"
echo ""
echo -e "${YELLOW}💡 Para descargar a tu PC local usa:${NC}"
echo -e "   scp -i tu-clave.pem ec2-user@TU-IP:$BACKUP_ROOT/${TIMESTAMP}.tar.gz ./"
echo ""
