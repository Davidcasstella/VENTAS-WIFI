#!/bin/bash
# ============================================================
# restore.sh — ChatWiFi Data Restore
# Run this AFTER deploying new code to recover saved data.
# Usage: ./restore.sh                   → uses latest backup
#        ./restore.sh 20240501-143022   → uses specific backup
# ============================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO_DIR="$HOME/VENTAS-WIFI/CHAT-WIFI"
DATA_DIR="$REPO_DIR/backend/data"
BACKUP_ROOT="$HOME/wifi-backups"

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     ChatWiFi — Restaurar Datos           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# 1. Find the backup to restore
if [ -n "$1" ]; then
    # Specific backup requested
    BACKUP_TIMESTAMP="$1"
    ARCHIVE="$BACKUP_ROOT/${BACKUP_TIMESTAMP}.tar.gz"
    BACKUP_DIR="$BACKUP_ROOT/$BACKUP_TIMESTAMP"
else
    # Use latest backup
    ARCHIVE=$(ls -t "$BACKUP_ROOT"/*.tar.gz 2>/dev/null | head -1)
    if [ -z "$ARCHIVE" ]; then
        echo -e "${RED}❌ No se encontraron backups en: $BACKUP_ROOT${NC}"
        echo -e "${YELLOW}💡 Primero ejecuta backup.sh para crear un backup${NC}"
        exit 1
    fi
    BACKUP_TIMESTAMP=$(basename "$ARCHIVE" .tar.gz)
    BACKUP_DIR="$BACKUP_ROOT/$BACKUP_TIMESTAMP"
fi

# 2. Extract archive if needed
if [ ! -d "$BACKUP_DIR" ] && [ -f "$ARCHIVE" ]; then
    echo -e "${BLUE}📦 Extrayendo backup: $ARCHIVE${NC}"
    cd "$BACKUP_ROOT"
    tar -xzf "$ARCHIVE"
fi

if [ ! -d "$BACKUP_DIR" ]; then
    echo -e "${RED}❌ No se encontró el backup: $BACKUP_DIR${NC}"
    exit 1
fi

echo -e "${YELLOW}📁 Restaurando desde: $BACKUP_DIR${NC}"
echo -e "${YELLOW}⏰ Timestamp: $BACKUP_TIMESTAMP${NC}"
echo ""

# 3. Ensure data directory exists
mkdir -p "$DATA_DIR"

# 4. Restore JSON files
echo -e "${BLUE}💬 Restaurando mensajes y configuración...${NC}"
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
    if [ -f "$BACKUP_DIR/$file" ]; then
        cp "$BACKUP_DIR/$file" "$DATA_DIR/$file"
        echo -e "   ✅ $file restaurado"
    else
        echo -e "   ⚠️  $file no estaba en el backup (se omite)"
    fi
done

# 5. Restore SQLite media database
echo ""
echo -e "${BLUE}🗄️  Restaurando base de datos de media...${NC}"
if [ -f "$BACKUP_DIR/media.db" ]; then
    cp "$BACKUP_DIR/media.db" "$DATA_DIR/media.db"
    echo -e "   ✅ media.db restaurado"
fi

# 6. Restore media files
echo ""
echo -e "${BLUE}📸🎵 Restaurando archivos de media (fotos/audios/videos)...${NC}"
if [ -d "$BACKUP_DIR/media" ]; then
    mkdir -p "$DATA_DIR/media"
    cp -r "$BACKUP_DIR/media/." "$DATA_DIR/media/"
    MEDIA_COUNT=$(find "$DATA_DIR/media" -type f | wc -l)
    echo -e "   ✅ $MEDIA_COUNT archivos de media restaurados"
else
    echo -e "   ⚠️  No había archivos de media en el backup"
fi

# 7. Summary
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       ✅ RESTAURACIÓN COMPLETADA         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}💡 Ahora reinicia el backend:${NC}"
echo -e "   pm2 restart wifi-backend"
echo ""
