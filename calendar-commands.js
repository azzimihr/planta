/* --- Calendar commands: mutations and print --- */

Calendar.cmd = (() => {
    const {
        ParseError, parseLocation, parseDistance, parseName, parseDate,
        parseDays, parseDaysOrDate, parseColor, parseItem, parseRange, parseViewRange,
        parseTime, parseDuration,
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
        if (args.length !== 4) throw new ParseError(`usage: template <name> <location> <color> <duration>`);
        const name = parseName(args[0]);
        const location = parseLocation(args[1]);
        const color = parseColor(args[2]);
        const duration = parseDuration(args[3]);
        if (state.templates[name]) throw new Error(`template already exists: ${name}`);
        state.templates[name] = { location, color, duration, items: [] };
        save();
    }

        function addEvent(args) {
        const state = getState();
        if (args.length < 4 || args.length > 5)
                throw new ParseError(`usage: add <w|d selector> <range> <location> <name> [color]`);
            const [selector, rangeStr, locStr, nameStr, colorStr] = args;
        const name = parseName(nameStr);
        const location = parseLocation(locStr);
        const color = colorStr ? parseColor(colorStr) : Calendar.randomColor();
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
        if (args.length !== 4)
            throw new ParseError(`usage: addt <w|d selector> <start> <template> <name>`);
        const [selector, startStr, tmplName, nameStr] = args;
        const t = state.templates[tmplName];
        if (!t) throw new Error(`template not found: ${tmplName}`);
        if (!Number.isFinite(t.duration)) throw new Error(`template has no duration: ${tmplName}`);
        const name = parseName(nameStr);
        const start = parseTime(startStr);
        if (start + t.duration > 24 * 60) throw new ParseError(`event exceeds midnight: '${startStr}'`);
        if (findEvent(name)) throw new Error(`event name already used: ${name}`);
        const id = nextEventId();
        const base = { id, name, start, template: tmplName };

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
        if (args.length !== 4)
            throw new ParseError(`usage: t <days|date> <start> <template> <name>`);
        const [compact, startStr, tmplName, nameStr] = args;
        const t = state.templates[tmplName];
        if (!t) throw new Error(`template not found: ${tmplName}`);
        if (!Number.isFinite(t.duration)) throw new Error(`template has no duration: ${tmplName}`);
        const name = parseName(nameStr);
        const start = parseTime(startStr);
        if (start + t.duration > 24 * 60) throw new ParseError(`event exceeds midnight: '${startStr}'`);
        if (findEvent(name)) throw new Error(`event name already used: ${name}`);
        const parsed = parseDaysOrDate(compact);
        const id = nextEventId();
        const base = { id, name, start, template: tmplName };

        if (parsed.type === 'weekly') {
            base.days = parsed.value;
            state.weekly.push(base);
        } else {
            base.date = parsed.value;
            state.dated.push(base);
        }
        save(); rerender();
    }

    function addCompact(args) {
        const state = getState();
        if (args.length < 4 || args.length > 5)
            throw new ParseError(`usage: a <days|date> <range> <location> <name> [color]`);
        const [compact, rangeStr, locStr, nameStr, colorStr] = args;
        const name = parseName(nameStr);
        const location = parseLocation(locStr);
        const color = colorStr ? parseColor(colorStr) : Calendar.randomColor();
        const [start, end] = parseRange(rangeStr);
        if (findEvent(name)) throw new Error(`event name already used: ${name}`);
        const parsed = parseDaysOrDate(compact);
        const id = nextEventId();
        const base = { id, name, start, end, location, color };

        if (parsed.type === 'weekly') {
            base.days = parsed.value;
            state.weekly.push(base);
        } else {
            base.date = parsed.value;
            state.dated.push(base);
        }
        save(); rerender();
    }

    function setDays(str) {
        const state = getState();
        if (!str) str = '1-7';
        state.view.visibleDays = Calendar.parseVisibleDays(str);
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
        if (wi >= 0) {
            const eventId = state.weekly[wi].id;
            state.weekly.splice(wi, 1);
            removeLengthOverrides(state, eventId);
            save(); rerender(); return;
        }
        const di = state.dated.findIndex(e => e.name === name);
        if (di >= 0) {
            const eventId = state.dated[di].id;
            state.dated.splice(di, 1);
            removeLengthOverrides(state, eventId);
            save(); rerender(); return;
        }
        throw new Error(`event not found: ${name}`);
    }

    function removeLengthOverrides(state, eventId) {
        if (!eventId || !state.lengthOverrides) return;
        for (const date of Object.keys(state.lengthOverrides)) {
            delete state.lengthOverrides[date][eventId];
            if (Object.keys(state.lengthOverrides[date]).length === 0)
                delete state.lengthOverrides[date];
        }
    }

    function deleteTemplate(name) {
        const state = getState();
        if (!state.templates[name]) throw new Error(`template not found: ${name}`);
        for (const ev of [...state.weekly, ...state.dated]) {
            if (ev.template === name) {
                ev.location = state.templates[name].location;
                ev.color = state.templates[name].color;
                ev.duration = state.templates[name].duration;
                ev.end = ev.start + ev.duration;
                delete ev.template;
            }
        }

        delete state.templates[name];
        save();
    }

    function setLength(args) {
        if (args.length !== 3) throw new ParseError(`usage: length <event> <date> <duration>`);
        const state = getState();
        const [eventName, dateArg, durationArg] = args;
        const ev = findEvent(eventName);
        if (!ev) throw new Error(`event not found: ${eventName}`);
        if (!ev.template || !state.templates[ev.template])
            throw new Error(`event is not templated: ${eventName}`);

        const date = parseDate('d' + dateArg);
        const [year, month, day] = date.split('-').map(Number);
        const dow = new Date(year, month - 1, day).getDay() || 7;
        const occurs = ev.days ? ev.days.includes(dow) : ev.date === date;
        if (!occurs) throw new Error(`event does not occur on ${date}: ${eventName}`);

        const duration = parseDuration(durationArg);
        if (ev.start + duration > 24 * 60)
            throw new ParseError(`event exceeds midnight: '${durationArg}'`);
        if (!state.lengthOverrides) state.lengthOverrides = {};
        if (!state.lengthOverrides[date]) state.lengthOverrides[date] = {};
        state.lengthOverrides[date][ev.id] = duration;
        save(); rerender();
    }

    function setView(rangeStr) {
        const state = getState();
        const [start, end] = parseViewRange(rangeStr);
        state.view.startHour = start;
        state.view.endHour = end;
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
        const template = ev.template && state.templates[ev.template];
        const duration = template?.duration ?? ev.duration ?? (ev.end - ev.start);
        const location = template?.location ?? ev.location;
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
            `  time       ${fmtTime(ev.start)} - ${fmtTime(ev.start + duration)}`,
            `  location   ${location}`,
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
            `  color      ${t.color}`,
            `  duration   ${fmtTime(t.duration)}`,
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
                t.color,
                Number.isFinite(t.duration) ? fmtTime(t.duration) : '(none)',
                (t.items || []).join(', ') || '(none)',
            ];
        });
        window.devConsole.print(fmtTable(['name', 'location', 'color', 'duration', 'items'], rows));
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
            const template = e.template && state.templates[e.template];
            const end = template ? e.start + template.duration : e.end;
            const location = template?.location ?? e.location;
            const when = e.days ? e.days.map(d => 'w' + d).join(',') : e.date;
            return [
                e.name,
                e.type,
                when,
                `${fmtTime(e.start)} - ${fmtTime(end)}`,
                location,
                effectiveColor(e) || '(default)',
            ];
        });
        window.devConsole.print(fmtTable(
            ['name', 'type', 'when', 'time', 'location', 'color'],
            rows
        ));
    }

    function addOverride(args) {
        const state = getState();
        if (!state.overrides) state.overrides = {};
        if (args.length === 0) throw new ParseError(`usage: or <date|range> [events...]`);
        
        const dateArg = args[0];
        const evNames = args.slice(1);
        
        let dates = [];
        if (dateArg.includes('-')) {
            const [startStr, endStr] = dateArg.split('-');
            const startISO = parseDate('d' + startStr);
            const endISO = parseDate('d' + endStr);
            
            const [sy, sm, sd] = startISO.split('-').map(Number);
            const [ey, em, ed] = endISO.split('-').map(Number);
            
            let curr = new Date(sy, sm - 1, sd);
            const end = new Date(ey, em - 1, ed);
            
            if (curr > end) throw new Error('start date must be before end date');
            
            while (curr <= end) {
                dates.push(fmtDateISO(curr));
                curr.setDate(curr.getDate() + 1);
            }
        } else {
            dates.push(parseDate('d' + dateArg));
        }

        for (const dStr of dates) {
            const [y, m, d] = dStr.split('-').map(Number);
            const dow = new Date(y, m - 1, d).getDay() || 7; // 1-7 (mon-sun)
            
            if (!state.overrides[dStr]) state.overrides[dStr] = [];
            const existing = new Set(state.overrides[dStr]);
            
            if (evNames.length === 0) {
                // Disable all recurring events currently scheduled for this day
                for (const ev of state.weekly) {
                    if (ev.days.includes(dow)) existing.add(ev.id);
                }
            } else {
                // Disable specific events
                for (const name of evNames) {
                    const ev = findEvent(name);
                    if (!ev) throw new Error(`event not found: ${name}`);
                    existing.add(ev.id);
                }
            }
            state.overrides[dStr] = [...existing];
            if (state.overrides[dStr].length === 0) {
                delete state.overrides[dStr];
            }
        }
        save(); rerender();
    }

    function restoreOverride(args) {
        const state = getState();
        if (!state.overrides) state.overrides = {};
        if (args.length === 0) throw new ParseError(`usage: restore <date|range> [events...]`);
        
        const dateArg = args[0];
        const evNames = args.slice(1);
        
        let dates = [];
        if (dateArg.includes('-')) {
            const [startStr, endStr] = dateArg.split('-');
            const startISO = parseDate('d' + startStr);
            const endISO = parseDate('d' + endStr);
            
            const [sy, sm, sd] = startISO.split('-').map(Number);
            const [ey, em, ed] = endISO.split('-').map(Number);
            
            let curr = new Date(sy, sm - 1, sd);
            const end = new Date(ey, em - 1, ed);
            
            if (curr > end) throw new Error('start date must be before end date');
            
            while (curr <= end) {
                dates.push(fmtDateISO(curr));
                curr.setDate(curr.getDate() + 1);
            }
        } else {
            dates.push(parseDate('d' + dateArg));
        }

        const dc = window.devConsole;
        let anyChange = false;

        for (const dStr of dates) {
            if (!state.overrides[dStr]) {
                // If they specified events, report they weren't overridden
                if (evNames.length > 0) {
                    for (const name of evNames) {
                        dc.print(`info: ${name} was not overridden on ${dStr}`);
                    }
                }
                continue;
            }
            
            if (evNames.length === 0) {
                delete state.overrides[dStr];
                dc.print(`restored: all overrides cleared for ${dStr}`);
                anyChange = true;
            } else {
                for (const name of evNames) {
                    const ev = findEvent(name);
                    if (!ev) {
                        dc.print(`info: event '${name}' not found`);
                        continue;
                    }
                    
                    const idx = state.overrides[dStr].indexOf(ev.id);
                    if (idx === -1) {
                        dc.print(`info: ${name} was not overridden on ${dStr}`);
                    } else {
                        state.overrides[dStr].splice(idx, 1);
                        dc.print(`restored: ${name} on ${dStr}`);
                        anyChange = true;
                    }
                }
                if (state.overrides[dStr].length === 0) {
                    delete state.overrides[dStr];
                }
            }
        }
        
        if (anyChange) {
            save(); rerender();
        }
    }

    function dumpAll() {
        const state = getState();
        state.distances = {};
        state.templates = {};
        state.weekly = [];
        state.dated = [];
        state.overrides = {};
        state.lengthOverrides = {};
        save();
        rerender();
    }

    return {
        addDistance, addTemplate, addEvent, addCompact, addTemplated, addTemplatedCompact,
        item,
        renameEvent,
        deleteEvent, deleteTemplate, setView, setDays,
        printEvent, printTemplate, printDistances,
        printAllTemplates, printAllEvents,
        addOverride, restoreOverride,
        setLength,
        dumpAll
    };
})();
