/* --- Calendar core: parsers, formatters, state, persistence, helpers --- */

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

    /* Time: [1-12 | a|b|c] [.MM] [a|p]?
     * MM: 1 digit (tens, 0-5) or 2 digits (literal 00-55, must be multiple of 5).
     * If no a/p: 7..c are AM (7:00..12:00), 1..6 are PM (13:00..18:00). */
    const RE_TIME  = /^(1[0-2]|[1-9]|[abc])(?:\.([0-9]{1,2}))?([ap])?$/;
    const RE_DIST  = /^(\d{1,2})(?:\.([0-9]{1,2}))?$/;
    const RE_DAYS  = /^w(\d(?:,\d)*)$/;
    const RE_DATE  = /^d(\d{2})(\d{2})(\d{2})$/;
    const RE_COLOR = /^[0-9a-f]{3}$/;
    const RE_LOC   = /^[a-z0-9_]{1,20}$/i;
    const RE_NAME  = /^[a-z0-9_]{1,20}$/i;
    const RE_VIEW  = /^(\d{1,2})-(\d{1,2})$/;
    const RE_COMPACT = /^[0-9]+$/;

    /* --- Parsers --- */
    function parseTime(s) {
        const m = RE_TIME.exec(s);
        if (!m) throw new ParseError(`invalid time: '${s}'`);

        let h;
        const hs = m[1];
        if (hs === 'a') h = 10;
        else if (hs === 'b') h = 11;
        else if (hs === 'c') h = 12;
        else h = parseInt(hs, 10);

        let min = 0;
        if (m[2] !== undefined) {
            if (m[2].length === 1) {
                const d = parseInt(m[2], 10);
                if (d > 5) throw new ParseError(`invalid minute: '${s}'`);
                min = d * 10;
            } else {
                min = parseInt(m[2], 10);
                if (min > 59 || min % 5 !== 0) throw new ParseError(`invalid minute: '${s}'`);
            }
        }

        const suffix = m[3];
        let hour24;
        if (suffix) {
            if (suffix === 'a') hour24 = (h === 12) ? 0  : h;
            else                hour24 = (h === 12) ? 12 : h + 12;
        } else {
            /* Auto-deduce: 7..12 -> AM, 1..6 -> PM */
            if (h >= 7 && h <= 12)      hour24 = h;
            else if (h >= 1 && h <= 6)  hour24 = h + 12;
            else                        throw new ParseError(`cannot deduce am/pm for hour ${h}`);
        }
        return hour24 * 60 + min;
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
        let min = 0;
        if (m[2] !== undefined) {
            if (m[2].length === 1) {
                const d = parseInt(m[2], 10);
                if (d > 5) throw new ParseError(`invalid distance minute: '${s}'`);
                min = d * 10;
            } else {
                min = parseInt(m[2], 10);
                if (min > 59 || min % 5 !== 0) throw new ParseError(`invalid distance minute: '${s}'`);
            }
        }
        return h * 60 + min;
    }

    function parseDays(s) {
        const m = RE_DAYS.exec(s);
        if (!m) throw new ParseError(`invalid days: '${s}'`);
        const days = [...new Set(m[1].split(',').map(d => parseInt(d, 10)))].sort((a,b)=>a-b);
        for (const d of days) if (d < 1 || d > 7) throw new ParseError(`invalid weekday: ${d}`);
        return days;
    }

    /* Compact: sorted ascending weekday digits -> weekly;
     * otherwise 6-digit -> date. */
    function parseDaysOrDate(s) {
        if (!RE_COMPACT.test(s)) throw new ParseError(`invalid day/date selector: '${s}'`);

        const allWeekday = /^[1-7]+$/.test(s);
        let sorted = true;
        for (let i = 1; i < s.length; i++) {
            if (s[i] < s[i-1]) { sorted = false; break; }
        }

        if (allWeekday && sorted) {
            const days = [...new Set(s.split('').map(d => parseInt(d, 10)))].sort((a,b)=>a-b);
            return { type: 'weekly', value: days };
        }
        if (s.length === 6) {
            return { type: 'dated', value: parseDate('d' + s) };
        }
        throw new ParseError(`invalid day/date selector: '${s}'`);
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
    function parseViewRange(s) {
        const m = RE_VIEW.exec(s);
        if (!m) throw new ParseError(`invalid view: '${s}'`);
        const start = parseInt(m[1], 10);
        const end   = parseInt(m[2], 10);
        if (start < 0 || start > 24 || end < 1 || end > 24 || end <= start)
            throw new ParseError(`invalid view range: '${s}'`);
        return [start, end];
    }

    /* --- Formatters --- */
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

    /* --- Helpers --- */
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
    function getMondayOf(date) {
        const d = new Date(date);
        d.setHours(0,0,0,0);
        const dow = d.getDay();
        d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
        return d;
    }
    function effectiveColor(ev) {
        if (ev.color) return ev.color;
        if (ev.template && state.templates[ev.template]) {
            return state.templates[ev.template].color || null;
        }
        return null;
    }
    function nextEventId() { return 'e' + (nextId++); }

    function ensureWeekStart() {
        if (!weekStart) weekStart = getMondayOf(new Date());
        return weekStart;
    }
    function setWeekStart(date) { weekStart = date; }

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.version === VERSION) {
                    replaceState(parsed);
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
    function replaceState(newState) {
        state = { ...DEFAULT_STATE(), ...newState };
        state.view = { ...DEFAULT_STATE().view, ...(newState.view || {}) };
        const ids = [...(state.weekly||[]), ...(state.dated||[])].map(e => e.id);
        nextId = ids.length ? Math.max(...ids.map(i => parseInt(i.slice(1), 10) || 0)) + 1 : 1;
    }

    function rerender() {
        if (Calendar.render && typeof Calendar.render.render === 'function') {
            Calendar.render.render();
        }
    }

    return {
        VERSION,
        ParseError,
        DEFAULT_STATE,

        parseTime, parseRange, parseDistance,
        parseDays, parseDaysOrDate, parseDate,
        parseColor, parseLocation, parseName, parseViewRange,

        fmtTime, fmtDateHuman, fmtDateISO,

        getState: () => state,
        replaceState, load, save,
        nextEventId,

        getWeekStart: ensureWeekStart,
        setWeekStart,
        getMondayOf,

        distanceKey, getDistance, findEvent, effectiveColor,

        rerender,
    };
})();