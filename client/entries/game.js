        import { COLOR_PALETTE, loadStoredProfile, saveStoredProfile } from '../shared/profile.js';
        import { applyMatchState, serializeMatchState } from '../network/match-state.js';
        import { createMatch, resetMatch, resizeMatch, setBotEnabled } from '../../engine/game.js';
        import { getStatsSnapshot, getUiSnapshot, stepWorld } from '../../engine/step.js';
        import { updateUi } from '../../engine/ui.js';
        import { cleanupDead, killEntity } from '../../engine/world.js';

        document.addEventListener('DOMContentLoaded', () => {
            const canvas = document.getElementById('gameCanvas');
            const ctx = canvas.getContext('2d');
            const messageBox = document.getElementById('messageBox');
            const messageText = document.getElementById('messageText');
            const optionsTabs = document.getElementById('optionsTabs');
            const optionsPanels = document.getElementById('optionsPanels');
                const tabLobbyButton = document.getElementById('tabLobbyButton');
            const tabConfigButton = document.getElementById('tabConfigButton');
            const tabLobbyPanel = document.getElementById('tab-lobby');
            const tabConfigPanel = document.getElementById('tab-config');
            const readyOnlineButton = document.getElementById('readyOnlineButton');
            const onlineReadyContainer = document.getElementById('online-ready-container');
            const onlineStatus = document.getElementById('onlineStatus');
            const playerNameInput = document.getElementById('playerNameInput');
            const colorSwatches = document.getElementById('colorSwatches');
            const observerToggle = document.getElementById('observerToggle');
            const roomLinkOption = document.getElementById('roomLinkOption');
            const roomLinkText = document.getElementById('roomLinkText');
            const copyRoomLinkButton = document.getElementById('copyRoomLinkButton');
            const pilotList = document.getElementById('pilotList');
            const readyButtonContainer = document.getElementById('ready-button-container');
            const bottomHud = document.getElementById('bottomHud');
            const gameContainer = document.getElementById('gameContainer');
            const gameSpeedSlider = document.getElementById('gameSpeedSlider');
            const gameSpeedValue = document.getElementById('gameSpeedValue');
            const borderModeSelect = document.getElementById('borderModeSelect');
            const gameModeSelect = document.getElementById('gameModeSelect');
            const maxShotsInput = document.getElementById('maxShotsInput');
            const objectiveScoreOption = document.getElementById('objectiveScoreOption');
            const objectiveScoreInput = document.getElementById('objectiveScoreInput');
            const stockLivesOption = document.getElementById('stockLivesOption');
            const stockLivesInput = document.getElementById('stockLivesInput');
            const timedLengthOption = document.getElementById('timedLengthOption');
            const timedLengthInput = document.getElementById('timedLengthInput');
            const missilesDieWithShipCheckbox = document.getElementById('missilesDieWithShipCheckbox');
            const mapSelect = document.getElementById('mapSelect');
            const extraBotsInput = document.getElementById('extraBotsInput');
            const victoryPanel = document.getElementById('victoryPanel');
            const victorySummary = document.getElementById('victorySummary');
            const victoryStats = document.getElementById('victoryStats');
            const rematchButton = document.getElementById('rematchButton');

            let isGameRunning = false;
            let isGamePaused = false;
            let animationFrameId;

            let onlineMode = false;
            let ws = null;
            let myPlayerIndex = null;
            let onlineReadySent = false;
            let localInputDown = {};
            let onlineStarted = false;
            let onlinePlayerOrder = null;
            let onlinePlayerColors = null;
            let onlineBotPlayers = new Set();
            let lastRoomPlayers = [];
            let victoryReadyAtMs = 0;
            let isVictoryOpen = false;
            let isObserver = false;

            let selectedColor = COLOR_PALETTE[0];
            let playerName = '';

            let match = null;

            let gameSpeed = 1;
            let maxShots = 3;
            let borderMode = 'outerSpace';
            let gameMode = 'point';
            let objectiveScore = 5;
            let stockLives = 5;
            let timedLengthSeconds = 120;
            let missilesDieWithShip = false;
            let mapId = 'classic';
            let extraBots = 0;

            const MAX_TOTAL_PLAYERS = 8;

            function setOnlineUiEnabled(enabled) {
                if (!onlineReadyContainer) return;
                onlineReadyContainer.style.display = enabled ? 'flex' : 'none';
            }

            function setOnlineStatus(text) {
                if (!onlineStatus) return;
                onlineStatus.textContent = text;
            }

            function randomPilotName() {
                return `Pilot ${Math.floor(100 + Math.random() * 900)}`;
            }

            function randomPaletteColor() {
                return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
            }

            function getStoredProfile() {
                return loadStoredProfile({
                    defaultName: randomPilotName,
                    fallbackColor: randomPaletteColor,
                    includeObserver: true,
                });
            }

            function getRoomIdFromPath() {
                const parts = location.pathname.split('/').filter(Boolean);
                if (parts.length >= 2 && parts[0] === 'r') return parts[1];
                return null;
            }

            const roomId = getRoomIdFromPath();
            const profile = getStoredProfile();
            playerName = profile.name;
            selectedColor = profile.color;
            isObserver = profile.observer;

            function wsUrl() {
                const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
                if (roomId) return `${proto}//${location.host}/ws/${roomId}`;
                return `${proto}//${location.host}/ws`;
            }

            function setRoomLinkUi() {
                if (!roomId || !roomLinkOption || !roomLinkText) return;
                roomLinkOption.style.display = 'flex';
                roomLinkText.textContent = `${location.origin}/r/${roomId}`;
            }

            function setActiveTab(tabName) {
                const isLobby = tabName === 'lobby';
                if (tabLobbyButton) tabLobbyButton.classList.toggle('is-active', isLobby);
                if (tabConfigButton) tabConfigButton.classList.toggle('is-active', !isLobby);
                if (tabLobbyPanel) tabLobbyPanel.classList.toggle('is-active', isLobby);
                if (tabConfigPanel) tabConfigPanel.classList.toggle('is-active', !isLobby);
            }

            function renderPilotList(players) {
                if (!pilotList) return;
                pilotList.innerHTML = '';

                if (!Array.isArray(players) || players.length === 0) {
                    const row = document.createElement('div');
                    row.className = 'pilot-row';
                    row.textContent = 'Waiting for pilots to join...';
                    pilotList.appendChild(row);
                    return;
                }

                players.forEach((p) => {
                    const row = document.createElement('div');
                    row.className = 'pilot-row';

                    const left = document.createElement('div');
                    left.className = 'pilot-left';

                    const color = document.createElement('div');
                    color.className = 'pilot-color';
                    color.style.backgroundColor = p && p.color ? p.color : '#ffffff';

                    const name = document.createElement('div');
                    const label = p && p.name ? p.name : `Pilot ${p?.playerIndex ?? '?'}`;
                    name.textContent = p && p.playerIndex === myPlayerIndex ? `${label} (You)` : label;

                    left.appendChild(color);
                    left.appendChild(name);

                    const status = document.createElement('div');
                    status.className = 'pilot-status';
                    if (p && p.observer) status.textContent = 'Observer';
                    else status.textContent = p && p.ready ? 'Ready' : 'Not Ready';

                    row.appendChild(left);
                    row.appendChild(status);
                    pilotList.appendChild(row);
                });
            }

            function buildColorsFromPlayers(players) {
                const nextColors = {};
                if (!Array.isArray(players)) return nextColors;
                for (const p of players) {
                    if (!p || !p.playerIndex) continue;
                    if (p.color && typeof p.color === 'string') {
                        nextColors[p.playerIndex] = p.color;
                    }
                }
                return nextColors;
            }

            function syncPlayerColors(players) {
                if (!Array.isArray(players)) return;

                const nextColors = {};
                for (const p of players) {
                    if (!p || !p.playerIndex) continue;
                    if (p.color && typeof p.color === 'string') {
                        nextColors[p.playerIndex] = p.color;
                    }
                }
                if (Object.keys(nextColors).length === 0) return;
                onlinePlayerColors = nextColors;

                if (!match) return;
                for (const [id, ship] of match.world.stores.ship) {
                    const color = nextColors[ship.playerIndex];
                    if (color) ship.color = color;
                }

                syncHud(getUiSnapshot(match.world), { activePlayerIndex: getActiveHudIndex() });
            }

            function orderedHudShips(snapshot, activePlayerIndex) {
                if (!snapshot || !Array.isArray(snapshot.ships)) return;

                const ships = [...snapshot.ships].sort((a, b) => a.playerIndex - b.playerIndex);
                if (activePlayerIndex == null) return ships;

                const active = ships.find((ship) => ship.playerIndex === activePlayerIndex);
                if (!active) return ships;
                return [active, ...ships.filter((ship) => ship.playerIndex !== activePlayerIndex)];
            }

            function updateBottomHud(snapshot, { activePlayerIndex = null } = {}) {
                if (!bottomHud) return;

                const ships = orderedHudShips(snapshot, activePlayerIndex);
                if (!Array.isArray(ships)) return;

                const statsSnap = gameMode === 'stock' && match ? getStatsSnapshot(match.world) : null;
                const statsByPlayer = new Map();
                if (statsSnap && Array.isArray(statsSnap.ships)) {
                    statsSnap.ships.forEach((s) => statsByPlayer.set(s.playerIndex, s));
                }

                bottomHud.innerHTML = '';
                ships.forEach((ship) => {
                    const item = document.createElement('div');
                    item.className = 'bottom-hud-item';

                    const label = document.createElement('div');
                    label.className = 'bottom-hud-label';
                    label.textContent = `P${ship.playerIndex} ${gameMode === 'stock' ? 'Lives' : 'Score'}`;

                    const value = document.createElement('div');
                    value.className = 'score-display';
                    if (gameMode === 'stock') {
                        const stats = statsByPlayer.get(ship.playerIndex);
                        const deaths = stats?.deaths ?? 0;
                        const lives = Math.max(0, stockLives - deaths);
                        value.textContent = String(lives);
                    } else {
                        value.textContent = String(ship.score ?? 0);
                    }

                    if (ship.color) value.style.color = ship.color;

                    item.appendChild(label);
                    item.appendChild(value);
                    bottomHud.appendChild(item);
                });
            }

            function syncHud(snapshot, { activePlayerIndex = null } = {}) {
                updateUi(document, snapshot, { activePlayerIndex });
                updateBottomHud(snapshot, { activePlayerIndex });
            }

            function updateProfileInputs() {
                if (playerNameInput) playerNameInput.value = playerName;
                if (observerToggle) observerToggle.checked = isObserver;
                if (!colorSwatches) return;
                [...colorSwatches.querySelectorAll('.color-swatch')].forEach((el) => {
                    el.classList.toggle('is-selected', el.dataset.color === selectedColor);
                });
                applyObserverUi();
            }

            function renderColorSwatches() {
                if (!colorSwatches) return;
                colorSwatches.innerHTML = '';
                COLOR_PALETTE.forEach((color) => {
                    const swatch = document.createElement('button');
                    swatch.type = 'button';
                    swatch.className = 'color-swatch';
                    swatch.style.background = color;
                    swatch.dataset.color = color;
                    swatch.setAttribute('aria-label', `Select ${color}`);
                    swatch.addEventListener('click', () => {
                        selectedColor = color;
                        persistProfile();
                        updateProfileInputs();
                        if (onlineMode) {
                            wsSend({ type: 'profile', name: playerName, color: selectedColor, observer: isObserver });
                        }
                    });
                    colorSwatches.appendChild(swatch);
                });
                updateProfileInputs();
            }

            function persistProfile() {
                const profile = saveStoredProfile({
                    name: playerName,
                    color: selectedColor,
                    observer: isObserver,
                    defaultName: randomPilotName,
                    fallbackColor: randomPaletteColor,
                    includeObserver: true,
                });
                playerName = profile.name;
                selectedColor = profile.color;
                isObserver = profile.observer;
            }

            function wsSend(obj) {
                if (!ws || ws.readyState !== WebSocket.OPEN) return;
                ws.send(JSON.stringify(obj));
            }

            function onlineAllowedKeys() {
                return new Set(['w', 'a', 'd', ' ']);
            }

            function actionForKey(k) {
                if (k === 'w') return 'thrust';
                if (k === 'a') return 'left';
                if (k === 'd') return 'right';
                if (k === ' ') return 'fire';
                return null;
            }

            function getOnlineConfigSnapshot() {
                return {
                    mapId,
                    borderMode,
                    maxShots,
                    gameMode,
                    objectiveScore,
                    stockLives,
                    timedLengthSeconds,
                    missilesDieWithShip,
                    gameSpeed,
                    extraBots,
                };
            }

            function isPlayerOne() {
                return myPlayerIndex === 1;
            }

            function getActiveHudIndex() {
                if (!onlineMode) return null;
                if (myPlayerIndex == null) return null;
                if (isObserver) return null;
                return myPlayerIndex;
            }

            function setOnlineControlsEnabled() {
                // Only player 1 can change settings before the match starts.
                const allow = onlineMode && isPlayerOne() && !onlineStarted && !isObserver;
                if (gameSpeedSlider) gameSpeedSlider.disabled = !allow;
                if (borderModeSelect) borderModeSelect.disabled = !allow;
                if (gameModeSelect) gameModeSelect.disabled = !allow;
                if (maxShotsInput) maxShotsInput.disabled = !allow;
                if (objectiveScoreInput) objectiveScoreInput.disabled = !allow;
                if (stockLivesInput) stockLivesInput.disabled = !allow;
                if (timedLengthInput) timedLengthInput.disabled = !allow;
                if (missilesDieWithShipCheckbox) missilesDieWithShipCheckbox.disabled = !allow;
                if (mapSelect) mapSelect.disabled = !allow;
                if (extraBotsInput) extraBotsInput.disabled = !allow;
            }

            function applyObserverUi() {
                if (observerToggle) {
                    observerToggle.checked = isObserver;
                    observerToggle.disabled = onlineMode && onlineStarted;
                }
                if (readyOnlineButton) {
                    readyOnlineButton.disabled = isObserver || onlineReadySent;
                }
            }

            function clamp(n, min, max) {
                return Math.max(min, Math.min(max, n));
            }

            function formatSpeed(n) {
                // Keep display stable: 1 decimal plus trailing 'x'.
                return `${n.toFixed(1)}x`;
            }

            function setGameSpeed(speed) {
                gameSpeed = clamp(Number(speed) || 1, 0.5, 4);
                if (gameSpeedSlider) gameSpeedSlider.value = String(gameSpeed);
                if (gameSpeedValue) gameSpeedValue.textContent = formatSpeed(gameSpeed);
                try {
                    localStorage.setItem('gduel.gameSpeed', String(gameSpeed));
                } catch (_) {
                    // Ignore storage failures (privacy mode, etc.)
                }
            }

            function borderColorFor(mode) {
                if (mode === 'concrete') return 'darkgray';
                if (mode === 'rubber') return 'hotpink';
                if (mode === 'wrap') return 'yellow';
                return 'white';
            }

            function applyBorderColor() {
                if (!gameContainer) return;
                gameContainer.style.borderColor = borderColorFor(borderMode);
            }

            function setBorderMode(mode) {
                borderMode = String(mode || 'outerSpace');
                if (borderModeSelect) borderModeSelect.value = borderMode;
                applyBorderColor();
                try {
                    localStorage.setItem('gduel.borderMode', borderMode);
                } catch (_) {
                    // Ignore storage failures
                }
            }

            function updateModeUi() {
                const isPoint = gameMode === 'point';
                const isStock = gameMode === 'stock';
                const isTimed = gameMode === 'timed';
                if (objectiveScoreOption) objectiveScoreOption.style.display = isPoint ? 'flex' : 'none';
                if (stockLivesOption) stockLivesOption.style.display = isStock ? 'flex' : 'none';
                if (timedLengthOption) timedLengthOption.style.display = isTimed ? 'flex' : 'none';
            }

            function setGameMode(mode) {
                const next = String(mode || 'point');
                gameMode = ['point', 'stock', 'timed'].includes(next) ? next : 'point';
                if (gameModeSelect) gameModeSelect.value = gameMode;
                updateModeUi();
                try {
                    localStorage.setItem('gduel.gameMode', gameMode);
                } catch (_) {
                    // Ignore storage failures
                }
                if (match) {
                    const snap = getUiSnapshot(match.world);
                    if (onlineMode && myPlayerIndex != null) syncHud(snap, { activePlayerIndex: getActiveHudIndex() });
                    else syncHud(snap);
                }
            }

            function setMap(id) {
                mapId = String(id || 'classic');
                if (mapSelect) mapSelect.value = mapId;
                try {
                    localStorage.setItem('gduel.mapId', mapId);
                } catch (_) {
                    // Ignore storage failures
                }

            }

            function parseExtraBots(value) {
                const n = Number(value);
                if (!Number.isFinite(n)) return 0;
                return Math.max(0, Math.floor(n));
            }

            function clampExtraBotsForPlayers() {
                const prev = extraBots;
                const maxExtraBots = Math.max(0, MAX_TOTAL_PLAYERS - 1);
                extraBots = Math.min(extraBots, maxExtraBots);
                if (extraBotsInput) extraBotsInput.value = String(extraBots);
                return extraBots !== prev;
            }

            function setExtraBots(value) {
                extraBots = parseExtraBots(value);
                clampExtraBotsForPlayers();
                if (extraBotsInput) extraBotsInput.value = String(extraBots);
                try {
                    localStorage.setItem('gduel.extraBots', String(extraBots));
                } catch (_) {
                    // Ignore storage failures
                }
            }

            function applyOnlineBotAssignments() {
                if (!match || !onlineMode) return;
                for (const [id, ship] of match.world.stores.ship) {
                    const enabled = onlineBotPlayers.has(ship.playerIndex);
                    setBotEnabled(match.world, id, enabled);
                }
            }

            function parseMaxShots(value) {
                // No upper bound; keep it integer-ish.
                const n = Number(value);
                if (!Number.isFinite(n)) return 3;
                return Math.max(0, Math.floor(n));
            }

            function setMaxShots(value) {
                maxShots = parseMaxShots(value);
                if (maxShotsInput) maxShotsInput.value = String(maxShots);
                try {
                    localStorage.setItem('gduel.maxShots', String(maxShots));
                } catch (_) {
                    // Ignore storage failures
                }
            }

            function applyMaxShotsToMatch() {
                if (!match) return;
                for (const sid of match.shipIds || []) {
                    const ship = match.world.stores.ship.get(sid);
                    if (ship) ship.maxMissiles = maxShots;
                }
            }

            function setMissilesDieWithShip(enabled) {
                missilesDieWithShip = Boolean(enabled);
                if (missilesDieWithShipCheckbox) missilesDieWithShipCheckbox.checked = missilesDieWithShip;
                if (match) match.world.resources.missilesDieWithShip = missilesDieWithShip;
                try {
                    localStorage.setItem('gduel.missilesDieWithShip', missilesDieWithShip ? '1' : '0');
                } catch (_) {
                    // Ignore storage failures
                }
            }

            function parseObjectiveScore(value) {
                const n = Number(value);
                if (!Number.isFinite(n)) return 5;
                // No upper bound; keep it a sensible positive integer.
                return Math.max(1, Math.floor(n));
            }

            function setObjectiveScore(value) {
                objectiveScore = parseObjectiveScore(value);
                if (objectiveScoreInput) objectiveScoreInput.value = String(objectiveScore);
                try {
                    localStorage.setItem('gduel.objectiveScore', String(objectiveScore));
                } catch (_) {
                    // Ignore storage failures
                }
            }

            function parseStockLives(value) {
                const n = Number(value);
                if (!Number.isFinite(n)) return 5;
                return Math.max(1, Math.floor(n));
            }

            function setStockLives(value) {
                stockLives = parseStockLives(value);
                if (stockLivesInput) stockLivesInput.value = String(stockLives);
                try {
                    localStorage.setItem('gduel.stockLives', String(stockLives));
                } catch (_) {
                    // Ignore storage failures
                }
                if (gameMode === 'stock' && match) {
                    const snap = getUiSnapshot(match.world);
                    if (onlineMode && myPlayerIndex != null) syncHud(snap, { activePlayerIndex: getActiveHudIndex() });
                    else syncHud(snap);
                }
            }

            function parseTimedLengthSeconds(value) {
                const n = Number(value);
                if (!Number.isFinite(n)) return 120;
                return Math.max(30, Math.floor(n));
            }

            function setTimedLengthSeconds(value) {
                timedLengthSeconds = parseTimedLengthSeconds(value);
                if (timedLengthInput) timedLengthInput.value = String(timedLengthSeconds);
                try {
                    localStorage.setItem('gduel.timedLengthSeconds', String(timedLengthSeconds));
                } catch (_) {
                    // Ignore storage failures
                }
            }

            // Initialize from storage.
            try {
                const saved = localStorage.getItem('gduel.gameSpeed');
                if (saved != null) setGameSpeed(parseFloat(saved));
                else setGameSpeed(1);
            } catch (_) {
                setGameSpeed(1);
            }

            try {
                const savedBorder = localStorage.getItem('gduel.borderMode');
                if (savedBorder != null) setBorderMode(savedBorder);
                else setBorderMode('outerSpace');
            } catch (_) {
                setBorderMode('outerSpace');
            }

            try {
                const savedMode = localStorage.getItem('gduel.gameMode');
                if (savedMode != null) setGameMode(savedMode);
                else setGameMode('point');
            } catch (_) {
                setGameMode('point');
            }

            try {
                const savedMap = localStorage.getItem('gduel.mapId');
                if (savedMap != null) setMap(savedMap);
                else setMap('classic');
            } catch (_) {
                setMap('classic');
            }

            try {
                const savedShots = localStorage.getItem('gduel.maxShots');
                if (savedShots != null) setMaxShots(savedShots);
                else setMaxShots(3);
            } catch (_) {
                setMaxShots(3);
            }

            try {
                const savedObjective = localStorage.getItem('gduel.objectiveScore');
                if (savedObjective != null) setObjectiveScore(savedObjective);
                else setObjectiveScore(5);
            } catch (_) {
                setObjectiveScore(5);
            }

            try {
                const savedLives = localStorage.getItem('gduel.stockLives');
                if (savedLives != null) setStockLives(savedLives);
                else setStockLives(5);
            } catch (_) {
                setStockLives(5);
            }

            try {
                const savedTimed = localStorage.getItem('gduel.timedLengthSeconds');
                if (savedTimed != null) setTimedLengthSeconds(savedTimed);
                else setTimedLengthSeconds(120);
            } catch (_) {
                setTimedLengthSeconds(120);
            }

            try {
                const savedMissilesDie = localStorage.getItem('gduel.missilesDieWithShip');
                if (savedMissilesDie != null) setMissilesDieWithShip(savedMissilesDie !== '0');
                else setMissilesDieWithShip(false);
            } catch (_) {
                setMissilesDieWithShip(false);
            }

            try {
                const savedExtraBots = localStorage.getItem('gduel.extraBots');
                if (savedExtraBots != null) setExtraBots(savedExtraBots);
                else setExtraBots(0);
            } catch (_) {
                setExtraBots(0);
            }

            if (gameSpeedSlider) {
                gameSpeedSlider.addEventListener('input', (e) => {
                    setGameSpeed(e.target.value);
                });
            }

            if (borderModeSelect) {
                borderModeSelect.addEventListener('change', (e) => {
                    setBorderMode(e.target.value);
                });
            }

            if (gameModeSelect) {
                gameModeSelect.addEventListener('change', (e) => {
                    setGameMode(e.target.value);
                });
            }

            if (mapSelect) {
                mapSelect.addEventListener('change', (e) => {
                    // Only allow changing map from the main menu / between rounds.
                    if (isGameRunning || isGamePaused) return;
                    setMap(e.target.value);
                });
            }

            if (extraBotsInput) {
                extraBotsInput.addEventListener('input', (e) => {
                    setExtraBots(e.target.value);
                });
            }

            if (maxShotsInput) {
                maxShotsInput.addEventListener('input', (e) => {
                    setMaxShots(e.target.value);
                    applyMaxShotsToMatch();
                    if (match) {
                        const snap = getUiSnapshot(match.world);
                        if (onlineMode && myPlayerIndex != null) syncHud(snap, { activePlayerIndex: getActiveHudIndex() });
                        else syncHud(snap);
                    }
                });
            }

            if (objectiveScoreInput) {
                objectiveScoreInput.addEventListener('input', (e) => {
                    setObjectiveScore(e.target.value);
                });
            }

            if (stockLivesInput) {
                stockLivesInput.addEventListener('input', (e) => {
                    setStockLives(e.target.value);
                });
            }

            if (timedLengthInput) {
                timedLengthInput.addEventListener('input', (e) => {
                    setTimedLengthSeconds(e.target.value);
                });
            }

            if (missilesDieWithShipCheckbox) {
                missilesDieWithShipCheckbox.addEventListener('change', (e) => {
                    setMissilesDieWithShip(e.target.checked);
                });
            }
            
            document.addEventListener('keydown', (e) => {
                const k = e.key.toLowerCase();

                if (!onlineMode || !isGameRunning || isGamePaused) return;
                if (!myPlayerIndex || isObserver) return;
                const allowed = onlineAllowedKeys();
                if (!allowed.has(k)) return;
                const action = actionForKey(k);
                if (!action) return;
                if (e.repeat || localInputDown[k]) return;
                localInputDown[k] = true;
                e.preventDefault();
                wsSend({ type: 'input', action, down: true });
            });
            document.addEventListener('keyup', (e) => {
                const k = e.key.toLowerCase();

                if (!onlineMode || !isGameRunning || isGamePaused) return;
                if (!myPlayerIndex || isObserver) return;
                const allowed = onlineAllowedKeys();
                if (!allowed.has(k)) return;
                const action = actionForKey(k);
                if (!action || !localInputDown[k]) return;
                localInputDown[k] = false;
                e.preventDefault();
                wsSend({ type: 'input', action, down: false });
            });

            function resetGame() {
                if (!match) return;
                applyMaxShotsToMatch();
                resetMatch(match.world, match);
            }

            function recreateMatch() {
                if (!Array.isArray(onlinePlayerOrder) || onlinePlayerOrder.length === 0) return;
                match = createMatch({
                    canvas,
                    ctx,
                    document,
                    maxMissiles: maxShots,
                    mapId,
                    playerOrder: onlinePlayerOrder,
                    playerColors: onlinePlayerColors,
                    onlineControls: true,
                });
                applyMaxShotsToMatch();
                resetGame();

                // Render a single frame for the start screen.
                stepWorld(
                    match.world,
                    { keys: {}, justPressed: new Set() },
                    {
                        dtMs: 0,
                        planetId: match.planetId,
                        borderMode,
                        winningScore: gameMode === 'point' ? objectiveScore : Number.POSITIVE_INFINITY,
                        missilesDieWithShip,
                    }
                );
                syncHud(getUiSnapshot(match.world), { activePlayerIndex: getActiveHudIndex() });
            }

            function getStatsForMatch() {
                if (!match) return [];
                const snap = getStatsSnapshot(match.world);
                return snap.ships.sort((a, b) => a.playerIndex - b.playerIndex);
            }

            function playerLabelForStats(stat) {
                return stat.playerIndex === myPlayerIndex ? 'You' : `Player ${stat.playerIndex}`;
            }

            function formatDurationMs(ms) {
                const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
                const minutes = Math.floor(totalSeconds / 60);
                const seconds = totalSeconds % 60;
                return `${minutes}:${String(seconds).padStart(2, '0')}`;
            }

            function renderVictoryStats(stats) {
                if (!victoryStats) return;
                victoryStats.innerHTML = '';
                stats.forEach((stat) => {
                    const row = document.createElement('div');
                    row.className = 'victory-row';

                    const label = document.createElement('div');
                    label.textContent = playerLabelForStats(stat);

                    const values = document.createElement('div');
                    values.textContent = `Kills ${stat.kills} | Deaths ${stat.deaths} | Crashes ${stat.crashes}`;

                    row.appendChild(label);
                    row.appendChild(values);
                    victoryStats.appendChild(row);
                });
            }

            function resolveOutcome(result) {
                const stats = getStatsForMatch();
                if (stats.length === 0) return null;

                if (gameMode === 'point') {
                    if (!result.winnerShipId) return null;
                    return {
                        winnerShipId: result.winnerShipId,
                        isDraw: false,
                        summary: `Point match to ${objectiveScore} points.`,
                    };
                }

                if (gameMode === 'stock') {
                    const alive = stats.filter((s) => (stockLives - s.deaths) > 0);
                    if (alive.length > 1) return null;
                    return {
                        winnerShipId: alive[0]?.id ?? null,
                        isDraw: alive.length === 0,
                        summary: `Stock match with ${stockLives} lives.`,
                    };
                }

                if (gameMode === 'timed') {
                    if ((match?.world.resources.gameTimeMs ?? 0) < timedLengthSeconds * 1000) return null;
                    const topScore = Math.max(...stats.map((s) => s.score));
                    const leaders = stats.filter((s) => s.score === topScore);
                    return {
                        winnerShipId: leaders.length === 1 ? leaders[0].id : null,
                        isDraw: leaders.length !== 1,
                        summary: `Timed match for ${formatDurationMs(timedLengthSeconds * 1000)}.`,
                    };
                }

                return null;
            }

            function enforceStockElimination() {
                if (gameMode !== 'stock' || !match) return;
                const stats = getStatsForMatch();
                for (const stat of stats) {
                    if (stat.deaths < stockLives) continue;
                    if (!match.world.stores.respawnAtMs.has(stat.id)) {
                        match.world.stores.respawnAtMs.set(stat.id, Number.POSITIVE_INFINITY);
                        const v = match.world.stores.velocity.get(stat.id);
                        if (v) {
                            v.x = 0;
                            v.y = 0;
                        }
                    } else {
                        match.world.stores.respawnAtMs.set(stat.id, Number.POSITIVE_INFINITY);
                    }
                }
            }

            function endGame(outcome) {
                isGameRunning = false;
                cancelAnimationFrame(animationFrameId);
                victoryReadyAtMs = performance.now() + 500;
                isVictoryOpen = true;
                const stats = getStatsForMatch();
                const winner = outcome?.winnerShipId
                    ? stats.find((s) => s.id === outcome.winnerShipId)
                    : null;
                let title = 'Match Over';
                if (outcome?.isDraw) {
                    title = 'Draw!';
                } else if (winner) {
                    const label = playerLabelForStats(winner);
                    title = label === 'You' ? 'You win!' : `${label} wins!`;
                }

                showMessageBox('victory', title);
                if (document.activeElement && typeof document.activeElement.blur === 'function') {
                    document.activeElement.blur();
                }
                if (rematchButton) rematchButton.blur();
                if (victorySummary) victorySummary.textContent = outcome?.summary ?? '';
                renderVictoryStats(stats);
            }

            function removePlayerShip(playerIndex) {
                if (!match || playerIndex == null) return;
                let shipId = null;

                for (const [id, ship] of match.world.stores.ship) {
                    if (ship && ship.playerIndex === playerIndex) {
                        shipId = id;
                        break;
                    }
                }

                if (!shipId) return;

                killEntity(match.world, shipId);
                cleanupDead(match.world);

                if (Array.isArray(match.shipIds)) {
                    match.shipIds = match.shipIds.filter((id) => id !== shipId);
                }

                if (Array.isArray(onlinePlayerOrder)) {
                    onlinePlayerOrder = onlinePlayerOrder.filter((idx) => idx !== playerIndex);
                }
                if (onlinePlayerColors && typeof onlinePlayerColors === 'object') {
                    delete onlinePlayerColors[playerIndex];
                    delete onlinePlayerColors[String(playerIndex)];
                }

                syncHud(getUiSnapshot(match.world), { activePlayerIndex: getActiveHudIndex() });
            }

            function handleDisconnectVictory(winnerIndex) {
                isGameRunning = false;
                isGamePaused = false;
                onlineStarted = false;
                cancelAnimationFrame(animationFrameId);

                onlineReadySent = false;
                if (readyOnlineButton) readyOnlineButton.disabled = false;

                if (match) {
                    resetGame();
                    stepWorld(
                        match.world,
                        { keys: {}, justPressed: new Set() },
                        {
                            dtMs: 0,
                            planetId: match.planetId,
                            borderMode,
                            winningScore: gameMode === 'point' ? objectiveScore : Number.POSITIVE_INFINITY,
                            missilesDieWithShip,
                        }
                    );
                    syncHud(getUiSnapshot(match.world), { activePlayerIndex: getActiveHudIndex() });
                }

                const label = winnerIndex && winnerIndex === myPlayerIndex ? 'You' : `Player ${winnerIndex}`;
                showMessageBox('start', `${label} win by disconnect.`);
            }

            function resizeCanvas() {
                const gameContainer = document.getElementById('gameContainer');
                canvas.width = gameContainer.clientWidth;
                canvas.height = gameContainer.clientHeight;

                if (!match) {
                    if (!Array.isArray(onlinePlayerOrder) || onlinePlayerOrder.length === 0) return;
                    match = createMatch({
                        canvas,
                        ctx,
                        document,
                        maxMissiles: maxShots,
                        mapId,
                        playerOrder: onlinePlayerOrder,
                        playerColors: onlinePlayerColors,
                        onlineControls: true,
                    });
                } else {
                    resizeMatch(match.world, match, { width: canvas.width, height: canvas.height });
                }

                if (!match) return;

                applyMaxShotsToMatch();

                resetGame();

                // Render a single frame for the start screen.
                stepWorld(
                    match.world,
                    { keys: {}, justPressed: new Set() },
                    {
                        dtMs: 0,
                        planetId: match.planetId,
                        borderMode,
                        winningScore: gameMode === 'point' ? objectiveScore : Number.POSITIVE_INFINITY,
                        missilesDieWithShip,
                    }
                );
                syncHud(getUiSnapshot(match.world), { activePlayerIndex: getActiveHudIndex() });
            }

            function showMessageBox(type, message) {
                if (type === 'start' && isVictoryOpen) return;
                messageText.textContent = message;
                messageBox.style.display = 'flex';
                if (victoryPanel) victoryPanel.classList.toggle('is-active', type === 'victory');
                
                if (type === 'start') {
                    readyButtonContainer.style.display = 'flex';
                    if (optionsTabs) optionsTabs.style.display = 'flex';
                    if (optionsPanels) optionsPanels.style.display = 'block';
                    if (victoryPanel) victoryPanel.classList.remove('is-active');
                } else if (type === 'victory') {
                    readyButtonContainer.style.display = 'none';
                    if (optionsTabs) optionsTabs.style.display = 'none';
                    if (optionsPanels) optionsPanels.style.display = 'none';
                }
            }
            
            function quitGame({ force = false } = {}) {
                if (isVictoryOpen && !force) return;
                if (onlineMode) {
                    wsSend({ type: 'end' });
                }
                isGameRunning = false;
                isGamePaused = false;
                cancelAnimationFrame(animationFrameId);
                isVictoryOpen = false;

                if (match) {
                    resetGame();
                    stepWorld(
                        match.world,
                        { keys: {}, justPressed: new Set() },
                        {
                            dtMs: 0,
                            planetId: match.planetId,
                            borderMode,
                            winningScore: gameMode === 'point' ? objectiveScore : Number.POSITIVE_INFINITY,
                            missilesDieWithShip,
                        }
                    );
                    syncHud(getUiSnapshot(match.world), { activePlayerIndex: getActiveHudIndex() });
                }

                showMessageBox('start', 'Online: click "Ready" when you are set.');
            }

            function startOnlineGame() {
                localInputDown = {};

                messageBox.style.display = 'none';
                isGameRunning = true;
                isGamePaused = false;
                isVictoryOpen = false;
                resetGame();

                onlineStarted = true;
                setOnlineControlsEnabled();

                // Online mode steps on server tick messages.
            }

            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);

            if (readyOnlineButton) {
                readyOnlineButton.addEventListener('click', () => {
                    if (!onlineMode) return;
                    if (isObserver) return;
                    if (onlineReadySent) return;
                    onlineReadySent = true;
                    readyOnlineButton.disabled = true;
                    wsSend({ type: 'profile', name: playerName, color: selectedColor, observer: isObserver });
                    wsSend({ type: 'ready', config: getOnlineConfigSnapshot() });
                    setOnlineStatus('Ready sent. Waiting for opponent…');
                });
            }
            
            if (rematchButton) {
                rematchButton.addEventListener('click', () => {
                    if (performance.now() < victoryReadyAtMs) return;
                    quitGame({ force: true });
                    window.location.href = window.location.pathname || '/';
                });
            }

            function applyOnlineConfig(cfg) {
                if (!cfg || typeof cfg !== 'object') return;
                if (cfg.mapId != null) setMap(cfg.mapId);
                if (cfg.borderMode != null) setBorderMode(cfg.borderMode);
                if (cfg.maxShots != null) setMaxShots(cfg.maxShots);
                if (cfg.gameMode != null) setGameMode(cfg.gameMode);
                if (cfg.objectiveScore != null) setObjectiveScore(cfg.objectiveScore);
                if (cfg.stockLives != null) setStockLives(cfg.stockLives);
                if (cfg.timedLengthSeconds != null) setTimedLengthSeconds(cfg.timedLengthSeconds);
                if (cfg.missilesDieWithShip != null) setMissilesDieWithShip(cfg.missilesDieWithShip);
                if (cfg.gameSpeed != null) setGameSpeed(cfg.gameSpeed);
                if (cfg.extraBots != null) setExtraBots(cfg.extraBots);

                setOnlineControlsEnabled();
            }

            function connectOnline() {
                if (!('WebSocket' in window)) return;

                try {
                    ws = new WebSocket(wsUrl());
                } catch (_) {
                    return;
                }

                ws.addEventListener('open', () => {
                    onlineMode = true;
                    onlineStarted = false;
                    onlinePlayerOrder = null;
                    onlinePlayerColors = null;
                    setOnlineUiEnabled(true);
                    setOnlineStatus('Connected. Waiting for assignment…');
                    showMessageBox('start', 'Online: click "Ready" when you are set.');
                    setOnlineControlsEnabled();
                    applyObserverUi();
                    wsSend({ type: 'profile', name: playerName, color: selectedColor, observer: isObserver });
                });

                ws.addEventListener('message', (ev) => {
                    let data;
                    try {
                        data = JSON.parse(ev.data);
                    } catch (_) {
                        return;
                    }

                    if (!data || typeof data !== 'object') return;

                    if (data.type === 'assigned') {
                        myPlayerIndex = data.playerIndex;
                        isObserver = Boolean(data.observer);
                        if (isObserver) setOnlineStatus(`Assigned Player ${myPlayerIndex}. Observer mode.`);
                        else setOnlineStatus(`Assigned Player ${myPlayerIndex}. Click Ready.`);
                        setOnlineControlsEnabled();
                        applyObserverUi();
                        return;
                    }

                    if (data.type === 'state-request') {
                        if (!match) return;
                        if (isObserver) return;
                        if (!isPlayerOne()) return;
                        wsSend({
                            type: 'state',
                            targetPlayerIndex: data.targetPlayerIndex,
                            state: serializeMatchState(match),
                        });
                        return;
                    }

                    if (data.type === 'profile') {
                        if (data.name && typeof data.name === 'string') playerName = data.name;
                        if (data.color && typeof data.color === 'string' && COLOR_PALETTE.includes(data.color)) {
                            selectedColor = data.color;
                        }
                        if (typeof data.observer === 'boolean') {
                            isObserver = data.observer;
                        }
                        persistProfile();
                        updateProfileInputs();
                        return;
                    }

                    if (data.type === 'room') {
                        const connected = data.connected ?? 0;
                        const readyCount = data.readyCount ?? 0;
                        const activeConnected = Array.isArray(data.players)
                            ? data.players.filter((p) => p && !p.observer).length
                            : connected;
                        const need = Math.ceil(activeConnected * 0.75);

                        let myReady = false;
                        let myObserver = false;
                        if (Array.isArray(data.players) && myPlayerIndex != null) {
                            const me = data.players.find(p => p && p.playerIndex === myPlayerIndex);
                            myReady = Boolean(me && me.ready);
                            myObserver = Boolean(me && me.observer);
                        }

                        if (myPlayerIndex != null) isObserver = myObserver;
                        onlineReadySent = myReady && !isObserver;
                        applyObserverUi();

                        if (!data.started) {
                            onlineStarted = false;
                            onlinePlayerOrder = null;
                            setOnlineControlsEnabled();
                        }

                        if (isObserver) {
                            setOnlineStatus(data.started ? 'Observer: match in progress.' : 'Observer: waiting for match.');
                        } else if (onlineReadySent) {
                            setOnlineStatus(`Ready sent. Waiting… (${readyCount}/${activeConnected}, need ${need})`);
                        } else {
                            setOnlineStatus(`Ready ${readyCount}/${activeConnected} (need ${need})`);
                        }

                        lastRoomPlayers = Array.isArray(data.players) ? data.players : [];
                        syncPlayerColors(Array.isArray(data.players) ? data.players : []);
                        renderPilotList(Array.isArray(data.players) ? data.players : []);
                        return;
                    }

                    if (data.type === 'config') {
                        applyOnlineConfig(data.config);
                        if (!onlineStarted) {
                            recreateMatch();
                        }
                        return;
                    }

                    if (data.type === 'start') {
                        onlineStarted = true;
                        onlinePlayerOrder = Array.isArray(data.playerOrder) ? data.playerOrder : null;
                        onlineBotPlayers = new Set(Array.isArray(data.botPlayers) ? data.botPlayers : []);
                        if (data.playerColors && typeof data.playerColors === 'object') {
                            onlinePlayerColors = data.playerColors;
                        } else {
                            onlinePlayerColors = buildColorsFromPlayers(lastRoomPlayers);
                        }
                        if (onlinePlayerColors && myPlayerIndex != null && !onlinePlayerColors[myPlayerIndex]) {
                            onlinePlayerColors[myPlayerIndex] = selectedColor;
                        }
                        applyOnlineConfig(data.config);
                        applyObserverUi();

                        recreateMatch();
                        startOnlineGame();
                        return;
                    }

                    if (data.type === 'state') {
                        if (!data.state || typeof data.state !== 'object') return;
                        if (!match) {
                            if (Array.isArray(data.state.playerOrder)) {
                                onlinePlayerOrder = data.state.playerOrder;
                            }
                            recreateMatch();
                        }
                        const applied = applyMatchState(match, data.state);
                        if (!applied) return;
                        const snap = getUiSnapshot(match.world);
                        const activeIndex = getActiveHudIndex();
                        if (activeIndex != null) syncHud(snap, { activePlayerIndex: activeIndex });
                        else syncHud(snap);
                        return;
                    }

                    if (data.type === 'leave') {
                        removePlayerShip(data.playerIndex);
                        return;
                    }

                    if (data.type === 'victory') {
                        if (!onlineMode) return;
                        handleDisconnectVictory(data.winnerPlayerIndex);
                        return;
                    }

                    if (data.type === 'tick') {
                        if (!onlineMode) return;
                        if (!isGameRunning || isGamePaused) return;
                        if (!match) return;

                        const dtMs = (Number(data.dtMs) || 0) * gameSpeed;
                        match.world.resources.gameTimeMs += dtMs;

                        applyOnlineBotAssignments();

                        const tickKeys = data.keys && typeof data.keys === 'object' ? data.keys : {};
                        const jp = Array.isArray(data.justPressed) ? data.justPressed : [];

                        const result = stepWorld(
                            match.world,
                            { keys: tickKeys, justPressed: new Set(jp) },
                            {
                                dtMs,
                                planetId: match.planetId,
                                borderMode,
                                winningScore: gameMode === 'point' ? objectiveScore : Number.POSITIVE_INFINITY,
                                missilesDieWithShip,
                            }
                        );

                        syncHud(getUiSnapshot(match.world), { activePlayerIndex: getActiveHudIndex() });
                        enforceStockElimination();

                        const outcome = resolveOutcome(result);
                        if (outcome) {
                            wsSend({ type: 'end' });
                            endGame(outcome);
                        }
                        return;
                    }

                    if (data.type === 'full') {
                        onlineMode = false;
                        onlineStarted = false;
                        setOnlineUiEnabled(false);
                        setOnlineControlsEnabled();
                        applyObserverUi();
                        showMessageBox('start', 'Online room is full.');
                        return;
                    }
                });

                ws.addEventListener('close', () => {
                    if (!onlineMode) return;
                    onlineMode = false;
                    onlineStarted = false;
                    onlinePlayerOrder = null;
                    onlinePlayerColors = null;
                    setOnlineUiEnabled(false);
                    setOnlineControlsEnabled();
                    applyObserverUi();
                    showMessageBox('start', 'Disconnected from online server.');
                });
            }

            // Default: try to enable online mode if /ws is available.
            setOnlineUiEnabled(false);
            setOnlineStatus('');
            setRoomLinkUi();
            renderColorSwatches();
            updateProfileInputs();
            renderPilotList([]);
            setActiveTab('lobby');
            connectOnline();

            if (tabLobbyButton) {
                tabLobbyButton.addEventListener('click', () => setActiveTab('lobby'));
            }
            if (tabConfigButton) {
                tabConfigButton.addEventListener('click', () => setActiveTab('config'));
            }

            if (playerNameInput) {
                playerNameInput.addEventListener('change', (e) => {
                    const value = String(e.target.value || '').trim();
                    playerName = value || playerName;
                    persistProfile();
                    if (onlineMode) {
                        wsSend({ type: 'profile', name: playerName, color: selectedColor, observer: isObserver });
                    }
                });
            }

            if (observerToggle) {
                observerToggle.addEventListener('change', (e) => {
                    isObserver = Boolean(e.target.checked);
                    onlineReadySent = false;
                    persistProfile();
                    updateProfileInputs();
                    setOnlineControlsEnabled();
                    if (onlineMode) {
                        wsSend({ type: 'profile', name: playerName, color: selectedColor, observer: isObserver });
                        if (isObserver) setOnlineStatus('Observer mode enabled.');
                    }
                });
            }

            if (copyRoomLinkButton) {
                copyRoomLinkButton.addEventListener('click', async () => {
                    if (!roomId) return;
                    const url = `${location.origin}/r/${roomId}`;
                    try {
                        await navigator.clipboard.writeText(url);
                        setOnlineStatus('Room link copied.');
                    } catch (_) {
                        setOnlineStatus('Copy failed. You can select the link manually.');
                    }
                });
            }

            function maybeSendOnlineConfig() {
                if (!onlineMode) return;
                if (isObserver) return;
                if (!isPlayerOne()) return;
                if (onlineStarted) return;
                wsSend({ type: 'config', config: getOnlineConfigSnapshot() });
            }

            if (gameSpeedSlider) gameSpeedSlider.addEventListener('change', maybeSendOnlineConfig);
            if (borderModeSelect) borderModeSelect.addEventListener('change', maybeSendOnlineConfig);
            if (gameModeSelect) gameModeSelect.addEventListener('change', maybeSendOnlineConfig);
            if (mapSelect) mapSelect.addEventListener('change', maybeSendOnlineConfig);
            if (maxShotsInput) maxShotsInput.addEventListener('change', maybeSendOnlineConfig);
            if (objectiveScoreInput) objectiveScoreInput.addEventListener('change', maybeSendOnlineConfig);
            if (stockLivesInput) stockLivesInput.addEventListener('change', maybeSendOnlineConfig);
            if (timedLengthInput) timedLengthInput.addEventListener('change', maybeSendOnlineConfig);
            if (missilesDieWithShipCheckbox) missilesDieWithShipCheckbox.addEventListener('change', maybeSendOnlineConfig);
            if (extraBotsInput) extraBotsInput.addEventListener('change', maybeSendOnlineConfig);

            showMessageBox('start', 'Click "Ready" to Begin');
        });
