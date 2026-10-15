/* --- dev-console: draggable, toggleable, extensible dev console --- */

class DevConsole extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
            <div class="console-titlebar">
                <span class="console-title">// dev.console</span>
                <button class="console-close" type="button">close</button>
            </div>
            <div class="console-history"></div>
            <div class="console-input-row">
                <span class="console-prompt">]</span>
                <input type="text" class="console-input" autocomplete="off" spellcheck="false">
            </div>
            <div class="console-resize" title="resize"></div>
        `;

        this.historyEl = this.querySelector('.console-history');
        this.inputEl   = this.querySelector('.console-input');
        this.titlebar  = this.querySelector('.console-titlebar');
        this.resizeEl  = this.querySelector('.console-resize');
        this.isOpen    = false;

        this.commands = {};
        this.commandHistory = [];
        this.historyIndex   = -1;

        // Built-ins
        this.registerCommand('clear', () => { this.historyEl.innerHTML = ''; });
        this.registerCommand('help',  () => {
            this.print(`available: ${Object.keys(this.commands).sort().join(', ')}`);
        });
        this.registerCommand('echo', (...args) => this.print(args.join(' ')));

        this._bindToggle();
        this._bindInput();
        this._bindDrag();
        this._bindResize();
        this._bindCloseButton();
        this._bindViewportClamp();

        window.devConsole = this;
    }

    /* --- Toggle --- */
    _bindToggle() {
        document.addEventListener('keydown', (e) => {
            if (e.key === '`' || e.code === 'Backquote') {
                const active = document.activeElement;
                if (active?.tagName === 'INPUT' && active !== this.inputEl) return;
                e.preventDefault();
                this.toggle();
            }
        });
    }

    toggle(force) {
        this.isOpen = typeof force === 'boolean' ? force : !this.isOpen;
        this.classList.toggle('open', this.isOpen);
        if (this.isOpen) {
            setTimeout(() => this.inputEl.focus(), 80);
        } else {
            this.inputEl.blur();
        }
    }

    /* --- Input handling --- */
    _bindInput() {
        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const cmd = this.inputEl.value.trim();
                if (cmd) {
                    this.execute(cmd);
                    this.commandHistory.push(cmd);
                }
                this.historyIndex = this.commandHistory.length;
                this.inputEl.value = '';
            }
            else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this.historyIndex > 0) {
                    this.historyIndex--;
                    this.inputEl.value = this.commandHistory[this.historyIndex];
                }
            }
            else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (this.historyIndex < this.commandHistory.length - 1) {
                    this.historyIndex++;
                    this.inputEl.value = this.commandHistory[this.historyIndex];
                } else {
                    this.historyIndex = this.commandHistory.length;
                    this.inputEl.value = '';
                }
            }
        });
    }

    /* --- Dragging via titlebar --- */
    _bindDrag() {
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        const onDown = (e) => {
            // Ignore drags that start on interactive elements in the titlebar
            if (e.target.closest('.console-close')) return;

            dragging = true;
            const rect = this.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;

            // Clear the CSS top/left defaults and switch to pixel positioning
            this.style.left = `${rect.left}px`;
            this.style.top  = `${rect.top}px`;

            this.titlebar.setPointerCapture(e.pointerId);
            e.preventDefault();
        };

        const onMove = (e) => {
            if (!dragging) return;

            let x = e.clientX - offsetX;
            let y = e.clientY - offsetY;

            // Keep window within the viewport bounds
            const w = this.offsetWidth;
            const h = this.offsetHeight;
            x = Math.max(0, Math.min(window.innerWidth  - w, x));
            y = Math.max(0, Math.min(window.innerHeight - h, y));

            this.style.left = `${x}px`;
            this.style.top  = `${y}px`;
        };

        const onUp = (e) => {
            if (!dragging) return;
            dragging = false;
            try { this.titlebar.releasePointerCapture(e.pointerId); } catch (_) {}
        };

        this.titlebar.addEventListener('pointerdown', onDown);
        this.titlebar.addEventListener('pointermove', onMove);
        this.titlebar.addEventListener('pointerup',   onUp);
        this.titlebar.addEventListener('pointercancel', onUp);
    }

        /* --- Resizing via bottom-right grip --- */
    _bindResize() {
        let resizing = false;
        let startX = 0, startY = 0;
        let startW = 0, startH = 0;

        const MIN_W = 320;
        const MIN_H = 220;

        const onDown = (e) => {
            resizing = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = this.getBoundingClientRect();
            startW = rect.width;
            startH = rect.height;

            // Freeze explicit dimensions so resizing is stable
            this.style.width  = startW + 'px';
            this.style.height = startH + 'px';

            this.resizeEl.setPointerCapture(e.pointerId);
            e.preventDefault();
            e.stopPropagation();
        };

        const onMove = (e) => {
            if (!resizing) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // Clamp against viewport too, so it can't be dragged off-edge
            const maxW = window.innerWidth  - this.getBoundingClientRect().left;
            const maxH = window.innerHeight - this.getBoundingClientRect().top;

            const w = Math.max(MIN_W, Math.min(startW + dx, Math.max(MIN_W, maxW)));
            const h = Math.max(MIN_H, Math.min(startH + dy, Math.max(MIN_H, maxH)));

            this.style.width  = w + 'px';
            this.style.height = h + 'px';
        };

        const onUp = (e) => {
            if (!resizing) return;
            resizing = false;
            try { this.resizeEl.releasePointerCapture(e.pointerId); } catch (_) {}
        };

        this.resizeEl.addEventListener('pointerdown', onDown);
        this.resizeEl.addEventListener('pointermove', onMove);
        this.resizeEl.addEventListener('pointerup',   onUp);
        this.resizeEl.addEventListener('pointercancel', onUp);
    }

    /* --- Keep console on screen when the window resizes --- */
    _bindViewportClamp() {
        const clamp = () => {
            const rect = this.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            let w = this.offsetWidth;
            let h = this.offsetHeight;
            let x = rect.left;
            let y = rect.top;

            // Shrink if the window is too small to hold the console
            if (w > vw) w = Math.max(320, vw - 20);
            if (h > vh) h = Math.max(220, vh - 20);

            // Keep a minimum visible titlebar even if we can't fully fit
            const minVisibleX = 120; // px of titlebar that must stay on screen
            const minVisibleY = 32;

            if (x + w < minVisibleX) x = minVisibleX - w;
            if (y + h < minVisibleY) y = minVisibleY - h;
            if (x > vw - minVisibleX) x = vw - minVisibleX;
            if (y > vh - minVisibleY) y = vh - minVisibleY;

            // Re-check after position moves
            if (x < 0) x = 0;
            if (y < 0) y = 0;

            this.style.width  = w + 'px';
            this.style.height = h + 'px';
            this.style.left   = x + 'px';
            this.style.top    = y + 'px';
        };

        window.addEventListener('resize', clamp);

        // Also run once shortly after mount so that if the viewport is smaller
        // than the console's default size, it gets clamped immediately.
        setTimeout(clamp, 0);
    }

    /* --- Close button --- */
    _bindCloseButton() {
        this.querySelector('.console-close').addEventListener('click', () => {
            this.toggle(false);
        });
    }

    /* --- Output + command execution (unchanged API) --- */
    print(text, type = 'output') {
        const line = document.createElement('div');
        line.className = `console-line console-${type}`;
        line.textContent = text;
        this.historyEl.appendChild(line);
        this.historyEl.scrollTop = this.historyEl.scrollHeight;
    }

    registerCommand(name, fn) {
        this.commands[name.toLowerCase()] = fn;
    }

    execute(rawCmd) {
        this.print(`] ${rawCmd}`, 'input');

        const parts = rawCmd.split(/\s+/);
        const name  = parts[0].toLowerCase();
        const args  = parts.slice(1);

        const cmd = this.commands[name];
        if (!cmd) {
            this.print(`invalid command: '${name}'`, 'error');
            return;
        }

        try {
            cmd(...args);
        } catch (err) {
            this.print(`error: ${err.message}`, 'error');
        }
    }
}

customElements.define('dev-console', DevConsole);