/* --- Calendar: model, parsers, mutations, render, persistence --- */
const Calendar = (() => {
    const STORAGE_KEY = 'dashboard.calendar';
    const VERSION = 1;

    const DEFAULT_STATE = () => ({
        version: VERSION,
        distances: {},
        templates: {},
        weekly: [],
        dated: [],
        view: { startHour: 4, endHour: 22 },
    });

    let state = DEFAULT_STATE();
    let nextId = 1;
    let weekStart = null;

    class ParseError extends Error {}

    const RE_TIME   = /^(\d{1,2})(?:\.([0-5]))?([ap])$/;
    const RE_DIST   = /^(\d{1,2})(?:\.([0-5]))?$/;
    const RE_DAYS   = /^w(\d(?:,\d)*)$/;
    const RE_DATE   = /^d(\d{2})(\d{2})(\d{2})$/;
    const RE_COLOR  = /^[0-9a-f]{3}$/;
    const RE_LOC    = /^[a-z0-9_]{1,20}$/i;
    const RE_NAME   = /^[a-z0-9_]{1,20}$/i;
    const RE_VIEW   = /^(\d{1,2})-(\d{1,2})$/;

    // --- Parsers ---
    function parseTime(s) {
        const m = RE_TIME.exec(s);
        if (!m) throw new ParseError(`invalid time: '${s}'`);
        let h = parseInt(m[1], 10);
        const dec = m[2] ? parseInt(m[2], 10) : 0;
        const suffix = m[3];
        if (h < 1 || h > 12) throw new ParseError(`invalid hour: '${s}'`);
        if (suffix === 'a' && h === 12) h = 0;
        else if (suffix === 'p' && h !== 12) h += 12;
        return h * 60 + dec * 10;
    }
    function parseRange(s) {
        const parts = s.split('-');
        if (parts.length !== 2) throw new ParseError(`invalid range: '${s}'`);
        const start = parseTime(parts[0]);
        const end   = parseTime(parts[1]);
        if (end <= start) throw new ParseError(`end must be after start: '${s}'`);
        return [start, end];
    }
    function parseDistance(s) {
        const m = RE_DIST.exec(s);
        if (!m) throw new ParseError(`invalid distance: '${s}'`);
        const h = parseInt(m[1], 10);
        const dec = m[2] ? parseInt(m[2], 10) : 0;
        return h * 60 + dec * 10;
    }
    function parseDays(s) {
        const m = RE_DAYS.exec(s);
        if (!m) throw new ParseError(`invalid days: '${s}'`);
        const days = [...new Set(m[1].split(',').map(d => parseInt(d, 10)))].sort((a,b)=>a-b);
        for (const d of days) if (d < 1 || d > 7) throw new ParseError(`invalid weekday: ${d}`);
        return days;
    }
    function parseDate(s) {
        const m = RE_DATE.exec(s);
        if (!m) throw new ParseError(`invalid date: '${s}'`);
        const day = parseInt(m[1], 10), month = parseInt(m[2], 10), year = 2000 + parseInt(m[3], 10);
        const d = new Date(year, month - 1, day);
        if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day)
            throw new ParseError(`invalid date: '${s}'`);
        return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
    function parseColor(s) {
        if (!RE_COLOR.test(s)) throw new ParseError(`invalid color: '${s}'`);
        return '#' + s[0]+s[0] + s[1]+s[1] + s[2]+s[2];
    }
    function parseLocation(s) {
        if (!RE_LOC.test(s)) throw new ParseError(`invalid location: '${s}'`);
        return s;
    }
    function parseName(s) {
        if (!RE_NAME.test(s)) throw new ParseError(`invalid name: '${s}'`);
        return s;
    }

    // --- Formatting ---
    function fmtTime(min) {
        return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`;
    }
    function fmtDateHuman(d) {
        const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    }
    function fmtDateISO(d) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    // --- Helpers ---
    function distanceKey(a, b) { return [a, b].sort().join('|'); }
    function getDistance(a, b) {
        if (a === b) return 0;
        return state.distances[distanceKey(a, b)] || 0;
    }
    function findEvent(name) {
        return state.weekly.find(e => e.name === name)
            || state.dated.find(e => e.name === name)
            || null;
    }
    function getWeekStart(date) {
        const d = new Date(date);
        d.setHours(0,0,0,0);
        const dow = d.getDay();
        d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
        return d;
    }

    // --- Persistence ---
    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.version === VERSION) {
                    state = { ...DEFAULT_STATE(), ...parsed };
                    state.view = { ...DEFAULT_STATE().view, ...(parsed.view || {}) };
                    const ids = [...state.weekly, ...state.dated].map(e => e.id);
                    nextId = ids.length ? Math.max(...ids.map(i => parseInt(i.slice(1), 10) || 0)) + 1 : 1;
                    return;
                }
            }
        } catch (e) { console.warn('[calendar] load failed', e); }
        state = DEFAULT_STATE();
    }
    function save() {
        try {
            const current = localStorage.getItem(STORAGE_KEY);
            if (current) localStorage.setItem(STORAGE_KEY + '.bak', current);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) { console.warn('[calendar] save failed', e); }
    }

    // --- Mutations ---
    function addDistance(pair, distStr) {
        const parts = pair.split('-');
        if (parts.length !== 2) throw new ParseError(`invalid pair: '${pair}'`);
        const a = parseLocation(parts[0]);
        const b = parseLocation(parts[1]);
        if (a === b) throw new Error(`same-location distance is pointless: '${pair}'`);
        const minutes = parseDistance(distStr);
        const key = distanceKey(a, b);
        if (state.distances[key] !== undefined)
            throw new Error(`distance already defined: ${a}-${b}`);
        state.distances[key] = minutes;
        save(); render();
    }

    function addTemplate(args) {
        if (args.length < 2 || args.length > 3) throw new ParseError(`usage: template <name> <location> [color]`);
        const name = parseName(args[0]);
        const location = parseLocation(args[1]);
        const color = args[2] ? parseColor(args[2]) : null;
        if (state.templates[name]) throw new Error(`template already exists: ${name}`);
        state.templates[name] = { location, color };
        save();
    }

    function addEvent(args) {
        if (args.length < 4 || args.length > 5)
            throw new ParseError(`usage: add <w|d selector> <range> <name> <location> [color]`);
        const [selector, rangeStr, nameStr, locStr, colorStr] = args;
        const name = parseName(nameStr);
        const location = parseLocation(locStr);
        const color = colorStr ? parseColor(colorStr) : null;
        const [start, end] = parseRange(rangeStr);
        if (findEvent(name)) throw new Error(`event name already used: ${name}`);
        const id = 'e' + (nextId++);

        if (selector.startsWith('w')) {
            const days = parseDays(selector);
            state.weekly.push({ id, name, days, start, end, location, color });
        } else if (selector.startsWith('d')) {
            const date = parseDate(selector);
            state.dated.push({ id, name, date, start, end, location, color });
        } else {
            throw new ParseError(`invalid selector: '${selector}'`);
        }
        save(); render();
    }

    function addTemplated(args) {
        if (args.length < 4 || args.length > 5)
            throw new ParseError(`usage: addt <template> <w|d selector> <range> <name> [color]`);
        const [tmplName, selector, rangeStr, nameStr, colorStr] = args;
        const t = state.templates[tmplName];
        if (!t) throw new Error(`template not found: ${tmplName}`);
        const name = parseName(nameStr);
        const color = colorStr ? parseColor(colorStr) : t.color;
        const [start, end] = parseRange(rangeStr);
        if (findEvent(name)) throw new Error(`event name already used: ${name}`);
        const id = 'e' + (nextId++);
        const base = { id, name, start, end, location: t.location, color, template: tmplName };

        if (selector.startsWith('w')) {
            base.days = parseDays(selector);
            state.weekly.push(base);
        } else if (selector.startsWith('d')) {
            base.date = parseDate(selector);
            state.dated.push(base);
        } else {
            throw new ParseError(`invalid selector: '${selector}'`);
        }
        save(); render();
    }

    function deleteEvent(name) {
        const wi = state.weekly.findIndex(e => e.name === name);
        if (wi >= 0) { state.weekly.splice(wi, 1); save(); render(); return; }
        const di = state.dated.findIndex(e => e.name === name);
        if (di >= 0) { state.dated.splice(di, 1); save(); render(); return; }
        throw new Error(`event not found: ${name}`);
    }

    function deleteTemplate(name) {
        if (!state.templates[name]) throw new Error(`template not found: ${name}`);
        for (const ev of [...state.weekly, ...state.dated]) {
            if (ev.template === name) {
                if (!ev.color) ev.color = state.templates[name].color;
                delete ev.template;
            }
        }
        delete state.templates[name];
        save();
    }

    function setView(rangeStr) {
        const m = RE_VIEW.exec(rangeStr);
        if (!m) throw new ParseError(`invalid view: '${rangeStr}'`);
        const start = parseInt(m[1], 10);
        const end   = parseInt(m[2], 10);
        if (start < 0 || start > 24 || end < 1 || end > 24 || end <= start)
            throw new ParseError(`invalid view range: '${rangeStr}'`);
        state.view.startHour = start;
        state.view.endHour = end;
        save(); render();
    }

    // --- Print ---
    function printEvent(name) {
        const ev = findEvent(name);
        if (!ev) throw new Error(`event not found: ${name}`);
        const isWeekly = !!ev.days;
        const dayStr = isWeekly ? ev.days.map(d => 'w' + d).join(', ') : ev.date;
        const lines = [
            `ev         ${ev.name}`,
            `  type       ${isWeekly ? 'weekly' : 'dated'}`,
            `  ${isWeekly ? 'days       ' + dayStr : 'date       ' + dayStr}`,
            `  time       ${fmtTime(ev.start)} - ${fmtTime(ev.end)}`,
            `  location   ${ev.location}`,
            `  color      ${ev.color || '(default)'}${ev.template ? '  (from template ' + ev.template + ')' : ''}`,
        ].join('\n');
        window.devConsole.print(lines);
    }

    function printTemplate(name) {
        const t = state.templates[name];
        if (!t) throw new Error(`template not found: ${name}`);
        const users = [...state.weekly, ...state.dated].filter(e => e.template === name).map(e => e.name);
        const lines = [
            `template   ${name}`,
            `  location   ${t.location}`,
            `  color      ${t.color || '(none)'}`,
            `  used by    ${users.length ? users.join(', ') : '(none)'}`,
        ].join('\n');
        window.devConsole.print(lines);
    }

    function printDistances() {
        const keys = Object.keys(state.distances).sort();
        if (!keys.length) { window.devConsole.print('(no distances defined)'); return; }
        const lines = keys.map(k => {
            const [a, b] = k.split('|');
            return `${a} ↔ ${b}   ${fmtTime(state.distances[k])}`;
        }).join('\n');
        window.devConsole.print(lines);
    }

    // --- Render ---
    function render() {
        if (!weekStart) weekStart = getWeekStart(new Date());
        renderHeader();
        renderGrid();
        renderSidebarInfo();
        // Now-line after layout, but without scroll
        requestAnimationFrame(renderNowLine);
    }

    function renderHeader() {
        const rangeEl = document.getElementById('cal-range');
        if (!rangeEl) return;
        const end = new Date(weekStart);
        end.setDate(end.getDate() + 6);
        rangeEl.textContent = `${fmtDateHuman(weekStart)} — ${fmtDateHuman(end)}`;
    }

    function renderSidebarInfo() {
        const el = document.getElementById('cal-info');
        if (!el) return;
        const totalWeekly = state.weekly.length;
        const totalDated = state.dated.length;
        const inWeek = countEventsInWeek();
        el.innerHTML =
            `<strong>in view</strong>${inWeek} event${inWeek === 1 ? '' : 's'}` +
            `<strong>weekly</strong>${totalWeekly} defined` +
            `<strong>dated</strong>${totalDated} defined`;
    }

    function countEventsInWeek() {
        let n = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart);
            d.setDate(d.getDate() + i);
            const dow = i + 1;
            const iso = fmtDateISO(d);
            n += state.weekly.filter(e => e.days.includes(dow)).length;
            n += state.dated.filter(e => e.date === iso).length;
        }
        return n;
    }

        function renderGrid() {
        const grid = document.getElementById('cal-grid');
        const dayHead = document.getElementById('cal-day-head');
        const scrollEl = document.getElementById('cal-scroll');
        if (!grid || !dayHead || !scrollEl) return;

        const { startHour, endHour } = state.view;
        const totalHours = endHour - startHour;

        // Available height = scroll viewport minus the sticky day-head
        const headH = dayHead.offsetHeight || 44;
        const availH = (scrollEl.clientHeight || 0) - headH;

        const cssBase = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--cal-hour-height')
        ) || 72;
        const hourPx = availH > 0
            ? Math.max(cssBase, Math.floor(availH / totalHours))
            : cssBase;
        const totalPx = totalHours * hourPx;

        // Apply to CSS so gutter + gridline gradient follow.
        grid.style.setProperty('--cal-hour-height', hourPx + 'px');

        const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const today = new Date();
        const todayISO = fmtDateISO(today);

        // --- Day headers (pinned) ---
        let headHtml = '<div class="cal-head cal-head-corner"></div>';
        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart);
            date.setDate(date.getDate() + i);
            const isToday = fmtDateISO(date) === todayISO;
            headHtml += `<div class="cal-head ${isToday ? 'is-today' : ''}">${dayNames[i]} ${date.getDate()}</div>`;
        }
        dayHead.innerHTML = headHtml;

        // --- Grid body ---
        let html = '<div class="cal-gutter">';
        for (let h = startHour; h < endHour; h++) {
            html += `<div class="cal-hour">${String(h).padStart(2,'0')}:00</div>`;
        }
        html += '</div>';

        const inWeek = countEventsInWeek();
        const emptyOverlay = inWeek === 0 ? '<div class="cal-empty">no events this week</div>' : '';

        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart);
            date.setDate(date.getDate() + i);
            const dow = i + 1;
            const dateISO = fmtDateISO(date);
            const isToday = dateISO === todayISO;
            const events = collectEvents(dateISO, dow);
            computeTravel(events);
            markOverlaps(events);

            html += `<div class="cal-col ${isToday ? 'is-today' : ''}" data-day="${dow}" style="height:${totalPx}px">`;
            if (i === 0 && emptyOverlay) html += emptyOverlay;
            html += '<div class="cal-nowline"></div>';

            for (const ev of events) {
                const topMin = ev.start - ev.travel - startHour * 60;
                const bottomMin = ev.end - startHour * 60;
                const top = topMin * (hourPx / 60);
                const height = Math.max(0, (bottomMin - topMin) * (hourPx / 60));
                if (height <= 0) continue;
                if (top + height < 0) continue;
                if (top > totalPx) continue;

                const travelPx = ev.travel * (hourPx / 60);
                const color = ev.color || 'var(--cal-accent)';
                const cls = ev.isOverlapping ? 'cal-event is-overlapping' : 'cal-event';

                html += `<div class="${cls}" style="top:${top}px;height:${height}px;--ev-color:${color}">`;
                if (travelPx > 0) {
                    const showLabel = travelPx >= 16;
                    const leaveBy = ev.start - ev.travel;
                    html += `<div class="cal-event-travel" style="height:${travelPx}px">`;
                    if (showLabel) {
                        html += `<span class="cal-event-travel-label">leave ${fmtTime(leaveBy)}</span>`;
                    }
                    html += `</div>`;
                }
                html += `<div class="cal-event-body">`;
                html += `<span class="cal-event-name">${ev.name}</span>`;
                html += `<span class="cal-event-time">${fmtTime(ev.start)} - ${fmtTime(ev.end)}</span>`;
                html += `</div></div>`;
            }

            html += '</div>';
        }

        grid.innerHTML = html;
    }

    function collectEvents(dateISO, dow) {
        const out = [];
        for (const ev of state.weekly) if (ev.days.includes(dow)) out.push({ ...ev, kind: 'weekly' });
        for (const ev of state.dated) if (ev.date === dateISO) out.push({ ...ev, kind: 'dated' });
        out.sort((a, b) => {
            if (a.start !== b.start) return a.start - b.start;
            if (a.kind !== b.kind) return a.kind === 'weekly' ? -1 : 1;
            return (b.end - b.start) - (a.end - a.start);
        });
        return out;
    }

    function computeTravel(events) {
        let prevLoc = 'dorm';
        for (const ev of events) {
            ev.travel = getDistance(prevLoc, ev.location);
            prevLoc = ev.location;
        }
    }

    function markOverlaps(events) {
        for (let i = 0; i < events.length; i++) {
            events[i].isOverlapping = false;
            for (let j = 0; j < events.length; j++) {
                if (i === j) continue;
                const a = events[i], b = events[j];
                const aStart = a.start - a.travel, aEnd = a.end;
                const bStart = b.start - b.travel, bEnd = b.end;
                if (aStart < bEnd && bStart < aEnd) { events[i].isOverlapping = true; break; }
            }
        }
    }

    function renderNowLine() {
        const now = new Date();
        const minutes = now.getHours() * 60 + now.getMinutes();
        const { startHour, endHour } = state.view;
        if (minutes < startHour * 60 || minutes > endHour * 60) return;
        const grid = document.getElementById('cal-grid');
        const hourPx = parseFloat(
            grid?.style.getPropertyValue('--cal-hour-height') ||
            getComputedStyle(document.documentElement).getPropertyValue('--cal-hour-height')
        ) || 72;
        const top = (minutes - startHour * 60) * (hourPx / 60);
        const line = document.querySelector('.cal-col.is-today .cal-nowline');
        if (line) line.style.top = top + 'px';
    }

    // --- Week nav ---
    function shiftWeek(delta) {
        const grid = document.getElementById('cal-grid');
        const rangeEl = document.getElementById('cal-range');
        grid?.classList.add('is-switching');
        rangeEl?.classList.add(delta > 0 ? 'switch-left' : 'switch-right');
        setTimeout(() => {
            weekStart.setDate(weekStart.getDate() + delta * 7);
            render();
            grid?.classList.remove('is-switching');
        }, 200);
        setTimeout(() => {
            rangeEl?.classList.remove('switch-left', 'switch-right');
        }, 600);
    }
    function goToday() {
        weekStart = getWeekStart(new Date());
        render();
    }

    // --- Export / import ---
    function exportJSON() {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `calendar-${fmtDateISO(new Date())}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function importJSON(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result);
                if (!parsed || parsed.version !== VERSION) throw new Error('bad data');
                state = { ...DEFAULT_STATE(), ...parsed };
                state.view = { ...DEFAULT_STATE().view, ...(parsed.view || {}) };
                const ids = [...(state.weekly||[]), ...(state.dated||[])].map(e => e.id);
                nextId = ids.length ? Math.max(...ids.map(i => parseInt(i.slice(1), 10) || 0)) + 1 : 1;
                save();
                goToday();
                window.devConsole.print('imported.');
            } catch (e) {
                window.devConsole.print('bad data', 'error');
            }
        };
        reader.readAsText(file);
    }

    // --- Error feedback ---
    function flashError() {
        const panel = document.querySelector('.cal-panel');
        if (!panel) return;
        panel.classList.remove('flash-error');
        void panel.offsetWidth;
        panel.classList.add('flash-error');
        setTimeout(() => panel.classList.remove('flash-error'), 500);
    }

    // --- Auto-scroll to now ---
    function scrollToNow() {
        const scroll = document.getElementById('cal-scroll');
        if (!scroll) return;
        const now = new Date();
        const minutes = now.getHours() * 60 + now.getMinutes();
        const { startHour } = state.view;
        const hourPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cal-hour-height')) || 42;
        const target = (minutes - startHour * 60) * (hourPx / 60) - scroll.clientHeight / 2;
        scroll.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }

    // --- Init ---
    function init() {
        load();
        weekStart = getWeekStart(new Date());

        document.getElementById('cal-prev').addEventListener('click', () => shiftWeek(-1));
        document.getElementById('cal-next').addEventListener('click', () => shiftWeek(1));
        document.getElementById('cal-today').addEventListener('click', () => { goToday(); scrollToNow(); });
        document.getElementById('cal-back').addEventListener('click', () => {
            document.body.classList.remove('view-calendar');
            document.body.classList.add('view-home');
        });
        document.getElementById('cal-export').addEventListener('click', exportJSON);

        const importInput = document.createElement('input');
        importInput.type = 'file';
        importInput.accept = 'application/json,.json';
        importInput.addEventListener('change', () => {
            if (importInput.files[0]) importJSON(importInput.files[0]);
            importInput.value = '';
        });
        document.getElementById('cal-import').addEventListener('click', () => importInput.click());

        render();
        setInterval(renderNowLine, 60000);
        let resizeTimer = null;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => { render(); }, 120);
        });
    }

    return {
        init,
        render,
        show() {
            document.body.classList.remove('view-home');
            document.body.classList.add('view-calendar');
            weekStart = getWeekStart(new Date());
            render();
            // Wait for the view fade to complete before scrolling
            setTimeout(scrollToNow, 480);
        },
        flashError,
        cmd: {
            addDistance, addTemplate, addEvent, addTemplated,
            deleteEvent, deleteTemplate, setView,
            printEvent, printTemplate, printDistances,
        },
        ParseError,
    };
})();