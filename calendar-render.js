/* --- Calendar render: header, grid, legend, now-line --- */

Calendar.render = (() => {
    const {
        fmtTime, fmtDateHuman, fmtDateISO,
        getState, getWeekStart, effectiveColor, getDistance,
    } = Calendar;

    function render() {
        renderHeader();
        renderGrid();
        renderLegend();
        requestAnimationFrame(renderNowLine);
    }

    function renderHeader() {
        const rangeEl = document.getElementById('cal-range');
        if (!rangeEl) return;
        const ws = getWeekStart();
        const end = new Date(ws);
        end.setDate(end.getDate() + 6);
        rangeEl.textContent = `${fmtDateHuman(ws)} — ${fmtDateHuman(end)}`;
    }

    function renderLegend() {
        const el = document.getElementById('cal-legend');
        if (!el) return;

        const state = getState();
        const ws = getWeekStart();

        /* Map<colorKey, Set<label>>.
         * Label = template name if the event came from a template, else event name.
         * Duplicates collapse, so N events from one template render as one entry. */
        const buckets = new Map();
        const addToBucket = (ev) => {
            const c = effectiveColor(ev);
            const key = c || 'default';
            if (!buckets.has(key)) buckets.set(key, new Set());
            const label = ev.template || ev.name;
            buckets.get(key).add(label);
        };

        for (let i = 0; i < 7; i++) {
            const d = new Date(ws);
            d.setDate(d.getDate() + i);
            const dow = i + 1;
            const iso = fmtDateISO(d);
            for (const ev of state.weekly) if (ev.days.includes(dow)) addToBucket(ev);
            for (const ev of state.dated)  if (ev.date === iso)    addToBucket(ev);
        }

        if (buckets.size === 0) { el.innerHTML = ''; return; }

        /* Sort: explicit colors alphabetically, "default" last. */
        const keys = [...buckets.keys()].sort((a, b) => {
            if (a === 'default') return 1;
            if (b === 'default') return -1;
            return a.localeCompare(b);
        });

        let html = '<strong>legend</strong>';
        for (const key of keys) {
            const labels = [...buckets.get(key)].sort().join(', ');
            const style = key === 'default'
                ? 'background:var(--cal-accent)'
                : `background:${key}`;
            html +=
                `<div class="cal-legend-item">` +
                    `<span class="cal-legend-swatch" style="${style}"></span>` +
                    `<span class="cal-legend-label">${labels}</span>` +
                `</div>`;
        }
        el.innerHTML = html;
    }

    function countEventsInWeek() {
        const state = getState();
        const ws = getWeekStart();
        let n = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date(ws);
            d.setDate(d.getDate() + i);
            const dow = i + 1;
            const iso = fmtDateISO(d);
            n += state.weekly.filter(e => e.days.includes(dow)).length;
            n += state.dated.filter(e => e.date === iso).length;
        }
        return n;
    }

    function renderGrid() {
        const state = getState();
        const ws = getWeekStart();
        const grid = document.getElementById('cal-grid');
        const dayHead = document.getElementById('cal-day-head');
        const scrollEl = document.getElementById('cal-scroll');
        if (!grid || !dayHead || !scrollEl) return;

        const { startHour, endHour } = state.view;
        const totalHours = endHour - startHour;

        const headH = dayHead.offsetHeight || 44;
        const availH = (scrollEl.clientHeight || 0) - headH;
        const cssBase = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--cal-hour-height')
        ) || 72;
        const hourPx = availH > 0
            ? Math.max(cssBase, Math.floor(availH / totalHours))
            : cssBase;
        const totalPx = totalHours * hourPx;

        grid.style.setProperty('--cal-hour-height', hourPx + 'px');

        const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const today = new Date();
        const todayISO = fmtDateISO(today);

        /* --- Pinned day headers --- */
        let headHtml = '<div class="cal-head cal-head-corner"></div>';
        for (let i = 0; i < 7; i++) {
            const date = new Date(ws);
            date.setDate(date.getDate() + i);
            const isToday = fmtDateISO(date) === todayISO;
            headHtml += `<div class="cal-head ${isToday ? 'is-today' : ''}">${dayNames[i]} ${date.getDate()}</div>`;
        }
        dayHead.innerHTML = headHtml;

        /* --- Grid body --- */
        let html = '<div class="cal-gutter">';
        for (let h = startHour; h < endHour; h++) {
            html += `<div class="cal-hour">${String(h).padStart(2,'0')}:00</div>`;
        }
        html += '</div>';

        const inWeek = countEventsInWeek();
        const emptyOverlay = inWeek === 0 ? '<div class="cal-empty">no events this week</div>' : '';

        for (let i = 0; i < 7; i++) {
            const date = new Date(ws);
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
                const color = effectiveColor(ev) || 'var(--cal-accent)';
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
        const state = getState();
        const out = [];
        for (const ev of state.weekly) if (ev.days.includes(dow)) out.push({ ...ev, kind: 'weekly' });
        for (const ev of state.dated)  if (ev.date === dateISO) out.push({ ...ev, kind: 'dated' });
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
        const state = getState();
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

    function scrollToNow() {
        const state = getState();
        const scroll = document.getElementById('cal-scroll');
        if (!scroll) return;
        const now = new Date();
        const minutes = now.getHours() * 60 + now.getMinutes();
        const { startHour } = state.view;
        const hourPx = parseFloat(
            document.getElementById('cal-grid')?.style.getPropertyValue('--cal-hour-height') ||
            getComputedStyle(document.documentElement).getPropertyValue('--cal-hour-height')
        ) || 72;
        const target = (minutes - startHour * 60) * (hourPx / 60) - scroll.clientHeight / 2;
        scroll.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }

    return {
        render,
        renderNowLine,
        scrollToNow,
    };
})();