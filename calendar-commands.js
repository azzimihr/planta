/* --- Calendar commands: mutations and print --- */

Calendar.cmd = (() => {
    const {
        ParseError, parseLocation, parseDistance, parseName, parseDate,
        parseDays, parseDaysOrDate, parseColor, parseItem, parseRange, parseViewRange,
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
        const was = state.distances[key];
        state.distances[key] = minutes;
        save(); rerender();
        const verb = was !== undefined ? 'updated' : 'set';
        window.devConsole.print(`${verb}: ${a} ↔ ${b} = ${fmtTime(minutes)}`);
    }

    function addTemplate(args) {
        const state = getState();
        if (args.length < 2 || args.length > 3) throw new ParseError(`usage: template <name> <location> [color]`);
        const name = parseName(args[0]);
        const location = parseLocation(args[1]);
        const color = args[2] ? parseColor(args[2]) : null;
        if (state.templates[name]) throw new Error(`template already exists: ${name}`);
        state.templates[name] = { location, color, items: [] };
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

    /* item <template> + a b - c
     * Valid ops apply silently. Conflicts trigger a y/n prompt. */
    function item(args) {
        const state = getState();
        if (args.length < 2) throw new ParseError(`usage: item <template> + item1 item2 - item3`);
        const tmplName = args[0];
        const t = state.templates[tmplName];
        if (!t) throw new Error(`template not found: ${tmplName}`);
        if (!Array.isArray(t.items)) t.items = [];

        const ops = [];
        let mode = null;
        for (let i = 1; i < args.length; i++) {
            const a = args[i];
            if (a === '+') { mode = 'add'; continue; }
            if (a === '-') { mode = 'remove'; continue; }
            if (!mode) throw new ParseError(`expected + or - before '${a}'`);
            ops.push({ op: mode, item: parseItem(a) });
        }
        if (ops.length === 0) throw new ParseError(`no items specified`);

        const working = new Set(t.items);
        const report = [];
        let hasConflict = false;

        for (const { op, item } of ops) {
            if (op === 'add') {
                if (working.has(item)) {
                    report.push(`  + ${item.padEnd(18)} already present, will skip`);
                    hasConflict = true;
                } else {
                    working.add(item);
                    report.push(`  + ${item.padEnd(18)} will add`);
                }
            } else {
                if (!working.has(item)) {
                    report.push(`  - ${item.padEnd(18)} not present, will skip`);
                    hasConflict = true;
                } else {
                    working.delete(item);
                    report.push(`  - ${item.padEnd(18)} will remove`);
                }
            }
        }

        const finalItems = [...working].sort();

        if (!hasConflict) {
            t.items = finalItems;
            save(); rerender();
            window.devConsole.print(`items updated.`);
            return;
        }

        window.devConsole.prompt(
            report.join('\n') + '\n\napply valid ops? y/n',
            (yes) => {
                if (!yes) { window.devConsole.print('cancelled.'); return; }
                t.items = finalItems;
                save(); rerender();
                window.devConsole.print('applied.');
            }
        );
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

    function setDays(str) {
        const state = getState();
        state.view.visibleDays = Calendar.parseVisibleDays(str);
        save(); rerender();
    }

    /* --- Print helpers --- */
    function fmtTable(headers, rows) {
        const all = [headers, ...rows];
        const widths = headers.map((_, i) =>
            Math.max(...all.map(r => String(r[i] ?? '').length))
        );
        const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
        const sepLine    = widths.map(w => '─'.repeat(w)).join('  ');
        const dataLines  = rows.map(r =>
            r.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ')
        );
        return [headerLine, sepLine, ...dataLines].join('\n');
    }

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
        const items = (t.items || []).join(', ') || '(none)';
        const lines = [
            `template   ${name}`,
            `  location   ${t.location}`,
            `  color      ${t.color || '(none)'}`,
            `  items      ${items}`,
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

    function printAllTemplates() {
        const state = getState();
        const names = Object.keys(state.templates).sort();
        if (!names.length) { window.devConsole.print('(no templates)'); return; }
        const rows = names.map(n => {
            const t = state.templates[n];
            return [
                n,
                t.location,
                t.color || '(none)',
                (t.items || []).join(', ') || '(none)',
            ];
        });
        window.devConsole.print(fmtTable(['name', 'location', 'color', 'items'], rows));
    }

    function printAllEvents() {
        const state = getState();
        const all = [
            ...state.weekly.map(e => ({ ...e, type: 'weekly' })),
            ...state.dated.map(e => ({ ...e, type: 'dated' })),
        ];
        if (!all.length) { window.devConsole.print('(no events)'); return; }
        all.sort((a, b) => a.name.localeCompare(b.name));
        const rows = all.map(e => {
            const when = e.days ? e.days.map(d => 'w' + d).join(',') : e.date;
            return [
                e.name,
                e.type,
                when,
                `${fmtTime(e.start)} - ${fmtTime(e.end)}`,
                e.location,
                effectiveColor(e) || '(default)',
            ];
        });
        window.devConsole.print(fmtTable(
            ['name', 'type', 'when', 'time', 'location', 'color'],
            rows
        ));
    }

    return {
        addDistance, addTemplate, addEvent, addTemplated, addTemplatedCompact,
        item,
        renameEvent,
        deleteEvent, deleteTemplate, setView, setDays,
        printEvent, printTemplate, printDistances,
        printAllTemplates, printAllEvents,
    };
})();