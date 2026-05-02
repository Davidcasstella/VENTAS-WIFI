#!/bin/bash
# ============================================================
# deploy.sh — ChatWiFi Deploy Seguro con Backup Automático
# 
# Este script reemplaza tu flujo manual de deploy.
# Hace backup de los datos ANTES de actualizar el código,
# luego restaura los datos después del git reset.
#
# Uso: bash deploy.sh
# ============================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_DIR="$HOME/VENTAS-WIFI"
CHAT_DIR="$REPO_DIR/CHAT-WIFI"
DATA_DIR="$CHAT_DIR/backend/data"
BACKUP_ROOT="$HOME/wifi-backups"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"
BRANCH="progra-2"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     ChatWiFi — Deploy Seguro v2.0           ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── PASO 1: Backup de datos actuales ─────────────────────────
echo -e "${YELLOW}[1/6] 📦 Haciendo backup de datos actuales...${NC}"
mkdir -p "$BACKUP_DIR"

if [ -d "$DATA_DIR" ]; then
    # Backup JSON files
    for file in chat-history.json welcome-user-states.json welcome-automation.json \
                blocked-numbers.json follow-up-config.json follow-up-states.json \
                ai-automations.json ai-fallback.json bot-config.json; do
        [ -f "$DATA_DIR/$file" ] && cp "$DATA_DIR/$file" "$BACKUP_DIR/$file"
    done

    # Backup media database
    [ -f "$DATA_DIR/media.db" ] && cp "$DATA_DIR/media.db" "$BACKUP_DIR/media.db"

    # Backup media files (fotos/audios/videos)
    [ -d "$DATA_DIR/media" ] && cp -r "$DATA_DIR/media" "$BACKUP_DIR/media"

    MEDIA_COUNT=$(find "$DATA_DIR/media" -type f 2>/dev/null | wc -l)
    echo -e "   ✅ Datos guardados ($MEDIA_COUNT archivos de media)"
else
    echo -e "   ⚠️  Sin datos previos que respaldar (instalación nueva)"
fi

# ── PASO 2: Actualizar código desde GitHub ───────────────────
echo ""
echo -e "${YELLOW}[2/6] 📥 Descargando cambios de GitHub (rama: $BRANCH)...${NC}"
cd "$REPO_DIR"
git fetch origin
git reset --hard origin/$BRANCH
echo -e "   ✅ Código actualizado"

# ── PASO 3: Restaurar datos del backup ──────────────────────
echo ""
echo -e "${YELLOW}[3/6] 🔄 Restaurando datos guardados...${NC}"
mkdir -p "$DATA_DIR"

# Restore JSON files
for file in chat-history.json welcome-user-states.json welcome-automation.json \
            blocked-numbers.json follow-up-config.json follow-up-states.json \
            ai-automations.json ai-fallback.json bot-config.json; do
    if [ -f "$BACKUP_DIR/$file" ]; then
        cp "$BACKUP_DIR/$file" "$DATA_DIR/$file"
        echo -e "   ✅ $file restaurado"
    fi
done

# Restore media database
if [ -f "$BACKUP_DIR/media.db" ]; then
    cp "$BACKUP_DIR/media.db" "$DATA_DIR/media.db"
    echo -e "   ✅ media.db restaurado"
fi

# Restore media files
if [ -d "$BACKUP_DIR/media" ]; then
    mkdir -p "$DATA_DIR/media"
    cp -r "$BACKUP_DIR/media/." "$DATA_DIR/media/"
    RESTORED_COUNT=$(find "$DATA_DIR/media" -type f | wc -l)
    echo -e "   ✅ $RESTORED_COUNT archivos de media restaurados"
fi

# ── PASO 4: Build del frontend ───────────────────────────────
echo ""
echo -e "${YELLOW}[4/6] 🔨 Construyendo frontend...${NC}"
cd "$CHAT_DIR/frontend"
npm install --silent
npm run build
cp -r dist/* ../backend/public/
echo -e "   ✅ Frontend construido y copiado"

# ── PASO 5: Instalar dependencias del backend ────────────────
echo ""
echo -e "${YELLOW}[5/6] 📦 Instalando dependencias del backend...${NC}"
cd "$CHAT_DIR/backend"
npm install --silent
echo -e "   ✅ Dependencias instaladas"

# ── PASO 6: Reiniciar servidor ───────────────────────────────
echo ""
echo -e "${YELLOW}[6/6] 🚀 Reiniciando servidor...${NC}"
pm2 restart wifi-backend
sleep 2
pm2 status wifi-backend
echo -e "   ✅ Servidor reiniciado"

# ── Limpiar backups antiguos (guardar últimos 5) ─────────────
ls -t "$BACKUP_ROOT"/*.tar.gz 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null
ls -dt "$BACKUP_ROOT"/[0-9]*/ 2>/dev/null | tail -n +6 | xargs rm -rf 2>/dev/null

# ── Resumen final ────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         ✅ DEPLOY COMPLETADO                 ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "⏰ Timestamp: ${YELLOW}$TIMESTAMP${NC}"
echo -e "🔖 Rama:      ${YELLOW}$BRANCH${NC}"
echo -e "📦 Backup:    ${YELLOW}$BACKUP_DIR${NC}"
echo ""
