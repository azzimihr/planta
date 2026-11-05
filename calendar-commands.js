/* --- Calendar commands: mutations and print --- */

Calendar.cmd = (() => {
    const {
        ParseError, parseLocation, parseDistance, parseName, parseDate,
        parseDays, parseDaysOrDate, parseColor, parseRange, parseViewRange,
        fmtTime, getState, save, rerender, findEvent,
        distanceKey, effectiveColor, nextEventId,
    } = Calendar;

    function addDistance(pair, distStr) {
        const state = getState();
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
        save(); rerender();
    }

    function addTemplate(args) {
        const state = getState();
        if (args.length < 2 || args.length > 3) throw new ParseError(`usage: template <name> <location> [color]`);
        const name = parseName(args[0]);
        const location = parseLocation(args[1]);
        const color = args[2] ? parseColor(args[2]) : null;
        if (state.templates[name]) throw new Error(`template already exists: ${name}`);
        state.templates[name] = { location, color };
        save();
    }

    function addEvent(args) {
        const state = getState();
        if (args.length < 4 || args.length > 5)
            throw new ParseError(`usage: add <w|d selector> <range> <name> <location> [color]`);
        const [selector, rangeStr, nameStr, locStr, colorStr] = args;
        const name = parseName(nameStr);
        const location = parseLocation(locStr);
        const color = colorStr ? parseColor(colorStr) : null;
        const [start, end] = parseRange(rangeStr);
        if (findEvent(name)) throw new Error(`event name already used: ${name}`);
        const id = nextEventId();

        if (selector.startsWith('w')) {
            const days = parseDays(selector);
            state.weekly.push({ id, name, days, start, end, location, color });
        } else if (selector.startsWith('d')) {
            const date = parseDate(selector);
            state.dated.push({ id, name, date, start, end, location, color });
        } else {
            throw new ParseError(`invalid selector: '${selector}'`);
        }
        save(); rerender();
    }

    function addTemplated(args) {
        const state = getState();
        if (args.length < 4 || args.length > 5)
            throw new ParseError(`usage: addt <template> <w|d selector> <range> <name> [color]`);
        const [tmplName, selector, rangeStr, nameStr, colorStr] = args;
        const t = state.templates[tmplName];
        if (!t) throw new Error(`template not found: ${tmplName}`);
        const name = parseName(nameStr);
        const color = colorStr ? parseColor(colorStr) : null;
        const [start, end] = parseRange(rangeStr);
        if (findEvent(name)) throw new Error(`event name already used: ${name}`);
        const id = nextEventId();
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
        save(); rerender();
    }

    /* Compact templated add: 't vezbe 45 b.4-1.1 ntp' */
    function addTemplatedCompact(args) {
        const state = getState();
        if (args.length < 4 || args.length > 5)
            throw new ParseError(`usage: t <template> <days|date> <range> <name> [color]`);
        const [tmplName, compact, rangeStr, nameStr, colorStr] = args;
        const t = state.templates[tmplName];
        if (!t) throw new Error(`template not found: ${tmplName}`);
        const name = parseName(nameStr);
        const color = colorStr ? parseColor(colorStr) : null;
        const [start, end] = parseRange(rangeStr);
        if (findEvent(name)) throw new Error(`event name already used: ${name}`);
        const parsed = parseDaysOrDate(compact);
        const id = nextEventId();
        const base = { id, name, start, end, location: t.location, color, template: tmplName };

        if (parsed.type === 'weekly') {
            base.days = parsed.value;
            state.weekly.push(base);
        } else {
            base.date = parsed.value;
            state.dated.push(base);
        }
        save(); rerender();
    }

    function renameEvent(oldName, newName) {
        const state = getState();
        const ev = findEvent(oldName);
        if (!ev) throw new Error(`event not found: ${oldName}`);
        const parsed = parseName(newName);
        if (findEvent(newName)) throw new Error(`event name already used: ${newName}`);
        ev.name = parsed;
        save(); rerender();
    }

    function deleteEvent(name) {
        const state = getState();
        const wi = state.weekly.findIndex(e => e.name === name);
        if (wi >= 0) { state.weekly.splice(wi, 1); save(); rerender(); return; }
        const di = state.dated.findIndex(e => e.name === name);
        if (di >= 0) { state.dated.splice(di, 1); save(); rerender(); return; }
        throw new Error(`event not found: ${name}`);
    }

    function deleteTemplate(name) {
        const state = getState();
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
        const state = getState();
        const [start, end] = parseViewRange(rangeStr);
        state.view.startHour = start;
        state.view.endHour = end;
        save(); rerender();
    }

    /* --- Print --- */
    function printEvent(name) {
        const state = getState();
        const ev = findEvent(name);
        if (!ev) throw new Error(`event not found: ${name}`);
        const isWeekly = !!ev.days;
        const dayStr = isWeekly ? ev.days.map(d => 'w' + d).join(', ') : ev.date;

        let colorLine;
        if (ev.color) {
            colorLine = ev.color + (ev.template ? `  (explicit; template ${ev.template})` : '');
        } else if (ev.template && state.templates[ev.template]) {
            colorLine = (state.templates[ev.template].color || '(none)') + `  (from template ${ev.template})`;
        } else {
            colorLine = '(default)';
        }

        const lines = [
            `ev         ${ev.name}`,
            `  type       ${isWeekly ? 'weekly' : 'dated'}`,
            `  ${isWeekly ? 'days       ' + dayStr : 'date       ' + dayStr}`,
            `  time       ${fmtTime(ev.start)} - ${fmtTime(ev.end)}`,
            `  location   ${ev.location}`,
            `  color      ${colorLine}`,
        ].join('\n');
        window.devConsole.print(lines);
    }

    function printTemplate(name) {
        const state = getState();
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
        const state = getState();
        const keys = Object.keys(state.distances).sort();
        if (!keys.length) { window.devConsole.print('(no distances defined)'); return; }
        const lines = keys.map(k => {
            const [a, b] = k.split('|');
            return `${a} ↔ ${b}   ${fmtTime(state.distances[k])}`;
        }).join('\n');
        window.devConsole.print(lines);
    }

    return {
        addDistance, addTemplate, addEvent, addTemplated, addTemplatedCompact,
        renameEvent,
        deleteEvent, deleteTemplate, setView,
        printEvent, printTemplate, printDistances,
    };
})();