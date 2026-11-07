/* --- Calendar UI: init, navigation, import/export, public surface --- */

(() => {
    const {
        VERSION, replaceState, save, getState, getMondayOf,
        getWeekStart, setWeekStart, fmtDateISO,
    } = Calendar;

    const render = Calendar.render.render;
    const renderNowLine = Calendar.render.renderNowLine;
    const scrollToNow = Calendar.render.scrollToNow;

    function shiftWeek(delta) {
        const grid = document.getElementById('cal-grid');
        const rangeEl = document.getElementById('cal-range');
        grid?.classList.add('is-switching');
        rangeEl?.classList.add(delta > 0 ? 'switch-left' : 'switch-right');
        setTimeout(() => {
            const ws = getWeekStart();
            ws.setDate(ws.getDate() + delta * 7);
            render();
            grid?.classList.remove('is-switching');
        }, 200);
        setTimeout(() => {
            rangeEl?.classList.remove('switch-left', 'switch-right');
        }, 600);
    }

    function goToday() {
        setWeekStart(getMondayOf(new Date()));
        render();
    }

    function flashError() {
        const panel = document.querySelector('.cal-panel');
        if (!panel) return;
        panel.classList.remove('flash-error');
        void panel.offsetWidth;
        panel.classList.add('flash-error');
        setTimeout(() => panel.classList.remove('flash-error'), 500);
    }

    function exportJSON() {
        const state = getState();
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
                replaceState(parsed);
                save();
                goToday();
                window.devConsole.print('imported.');
            } catch (e) {
                window.devConsole.print('bad data', 'error');
            }
        };
        reader.readAsText(file);
    }

    function goHome() {
        document.body.classList.remove('view-calendar');
        document.body.classList.add('view-home');
    }

    function init() {
        Calendar.load();
        setWeekStart(getMondayOf(new Date()));

        document.getElementById('cal-prev').addEventListener('click', () => shiftWeek(-1));
        document.getElementById('cal-next').addEventListener('click', () => shiftWeek(1));
        document.getElementById('cal-today').addEventListener('click', () => { goToday(); scrollToNow(); });
        document.getElementById('cal-back').addEventListener('click', goHome);
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
        setInterval(renderNowLine, 1000);

        let resizeTimer = null;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => render(), 120);
        });

        // Press q to return home (when in calendar and not typing in the console)
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'q' && e.key !== 'Q') return;
            if (!document.body.classList.contains('view-calendar')) return;
            if (window.devConsole?.pendingPrompt) return;
            const active = document.activeElement;
            if (active && window.devConsole?.contains(active)) return;
            goHome();
        });
    }

    function show() {
        document.body.classList.remove('view-home');
        document.body.classList.add('view-calendar');
        setWeekStart(getMondayOf(new Date()));
        render();
        setTimeout(scrollToNow, 480);
    }

    Calendar.init     = init;
    Calendar.show     = show;
    Calendar.flashError = flashError;
    Calendar.exportJSON = exportJSON;
    Calendar.importJSON = importJSON;
    Calendar.goToday  = goToday;
    Calendar.shiftWeek = shiftWeek;
})();