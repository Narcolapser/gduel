        import { COLOR_PALETTE, loadStoredProfile, saveStoredProfile } from '../shared/profile.js';

        const nameInput = document.getElementById('playerName');
        const colorPicker = document.getElementById('colorPicker');
        const createButton = document.getElementById('createRoom');
        const statusEl = document.getElementById('status');

        let selectedColor = COLOR_PALETTE[0];

        function setStatus(message) {
            statusEl.textContent = message || '';
        }

        function renderColorPicker() {
            if (!colorPicker) return;
            colorPicker.innerHTML = '';
            COLOR_PALETTE.forEach((color) => {
                const swatch = document.createElement('button');
                swatch.type = 'button';
                swatch.className = 'color-swatch';
                swatch.style.background = color;
                swatch.dataset.color = color;
                swatch.setAttribute('aria-label', `Select ${color}`);
                swatch.addEventListener('click', () => {
                    selectedColor = color;
                    updateSwatchSelection();
                });
                colorPicker.appendChild(swatch);
            });
            updateSwatchSelection();
        }

        function updateSwatchSelection() {
            if (!colorPicker) return;
            [...colorPicker.querySelectorAll('.color-swatch')].forEach((el) => {
                el.classList.toggle('is-selected', el.dataset.color === selectedColor);
            });
        }

        function loadProfile() {
            const profile = loadStoredProfile({
                defaultName: 'Pilot',
                fallbackColor: COLOR_PALETTE[0],
            });
            if (nameInput) nameInput.value = profile.name;
            selectedColor = profile.color;
            renderColorPicker();
        }

        function saveProfile() {
            return saveStoredProfile({
                name: nameInput?.value,
                color: selectedColor,
                defaultName: 'Pilot',
                fallbackColor: COLOR_PALETTE[0],
            });
        }

        createButton.addEventListener('click', async () => {
            setStatus('Creating room...');
            createButton.disabled = true;
            const profile = saveProfile();

            try {
                const res = await fetch('/api/rooms', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                });

                if (!res.ok) throw new Error('Failed to create room');
                const data = await res.json();
                const roomUrl = data.roomUrl ? `${location.origin}${data.roomUrl}` : location.origin;
                setStatus(`Room ready for ${profile.name}. Entering...`);
                location.href = roomUrl;
            } catch (err) {
                setStatus('Could not create room. Please try again.');
            } finally {
                createButton.disabled = false;
            }
        });

        loadProfile();
