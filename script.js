document.addEventListener('DOMContentLoaded', () => {
    // --- Live Clock ---
    const clockElement = document.getElementById('clock');
    function updateTime() {
        const now = new Date();
        clockElement.textContent = now.toLocaleTimeString('en-US', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    }
    updateTime();
    setInterval(updateTime, 1000);

    // --- Floaty Physics Engine ---
    const shards = document.querySelectorAll('.menu-shard');
    const shapes = document.querySelectorAll('.shape');

    let mouseX = 0, mouseY = 0;
    let targetX = 0, targetY = 0;

    window.addEventListener('mousemove', (e) => {
        targetX = (e.clientX / window.innerWidth - 0.5) * 2;
        targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    });

    shards.forEach((shard, i) => {
        shard.dataset.offset = i * 2.5;
        shard.dataset.hover = 'false';
        const style = window.getComputedStyle(shard);
        let baseRot = style.getPropertyValue('--rot') || '0deg';
        shard.dataset.baseRot = parseFloat(baseRot);
        shard.dataset.currentScale = 1.0;
        shard.addEventListener('mouseenter', () => shard.dataset.hover = 'true');
        shard.addEventListener('mouseleave', () => shard.dataset.hover = 'false');
        shard.addEventListener('click', () => {
            console.log(`[system] initiating: ${shard.dataset.target}`);
        });
    });

        let lastFrameTime = 0;
    const targetFPS = 30;
    const frameInterval = 1000 / targetFPS; // ~33.33ms

    function animate(timestamp) {
        // Request the next frame immediately
        requestAnimationFrame(animate);

        // Throttle the physics math to 30fps
        if (timestamp - lastFrameTime < frameInterval) return;
        lastFrameTime = timestamp;

        // Only run the math if we are on the home screen
        if (document.body.classList.contains('view-home')) {
            // Use the precise timestamp for the math instead of Date.now()
            const t = timestamp * 0.001; 

            mouseX += (targetX - mouseX) * 0.05;
            mouseY += (targetY - mouseY) * 0.05;

            shards.forEach(shard => {
                const offset = parseFloat(shard.dataset.offset);
                const hovered = shard.dataset.hover === 'true';
                const baseRot = parseFloat(shard.dataset.baseRot);

                const floatX = Math.sin(t * 1.1 + offset) * 25;
                const floatY = Math.cos(t * 1.4 + offset) * 35;
                const floatRot = Math.sin(t * 0.8 + offset) * 8;

                const parX = mouseX * -45;
                const parY = mouseY * -45;

                let targetScale = hovered ? 1.12 : 1.0;
                let hoverWobble = hovered ? Math.sin(t * 3) * 1.5 : 0;
                let hoverPulse = hovered ? Math.sin(t * 2) * 0.01 : 0;

                shard.dataset.currentScale = parseFloat(shard.dataset.currentScale) + (targetScale - parseFloat(shard.dataset.currentScale)) * 0.15;
                const currentScale = parseFloat(shard.dataset.currentScale) + hoverPulse;

                const finalRot = baseRot + floatRot + hoverWobble;
                shard.style.transform = `translate3d(${floatX + parX}px, ${floatY + parY}px, 0) rotate(${finalRot}deg) scale(${currentScale})`;
            });

            shapes.forEach((shape, i) => {
                const speed = (i + 1) * 25;
                const rot = t * (i + 1) * 4;
                shape.style.transform = `translate3d(${mouseX * speed}px, ${mouseY * speed}px, 0) rotate(${rot}deg)`;
            });
        }
    }
    // Start the loop (you don't need to pass a timestamp manually)
    requestAnimationFrame(animate);

    // --- Backtick hint opens console ---
    document.getElementById('kbd-console')?.addEventListener('click', () => {
        window.devConsole?.toggle(true);
    });

    // --- Shard → view wiring ---
    document.querySelectorAll('.menu-shard').forEach(shard => {
        shard.addEventListener('click', () => {
            if (shard.dataset.target === 'calendar') Calendar.show();
        });
    });

    // --- Calendar command registration ---
    Calendar.init();
    const dc = window.devConsole;

    const run = (fn) => (...args) => {
        try {
            fn(...args);
        } catch (e) {
            if (e instanceof Calendar.ParseError) {
                dc.print('invalid command', 'error');
            } else {
                dc.print(e.message || String(e), 'error');
            }
            Calendar.flashError();
        }
    };

    const printDispatch = run((kind, name) => {
        if (kind === 'ev')            Calendar.cmd.printEvent(name);
        else if (kind === 'template') Calendar.cmd.printTemplate(name);
        else if (kind === 'distances')Calendar.cmd.printDistances();
        else throw new Calendar.ParseError(`unknown print target: ${kind}`);
    });

    dc.registerCommand('distance', run((pair, dist) => Calendar.cmd.addDistance(pair, dist)));
    dc.registerCommand('template', run((...a) => Calendar.cmd.addTemplate(a)));
    dc.registerCommand('add',      run((...a) => Calendar.cmd.addEvent(a)));
    dc.registerCommand('a', run((...a) => Calendar.cmd.addCompact(a)));
    dc.registerCommand('addt',     run((...a) => Calendar.cmd.addTemplated(a)));
    dc.registerCommand('t',        run((...a) => Calendar.cmd.addTemplatedCompact(a)));
    dc.registerCommand('item',     run((...a) => Calendar.cmd.item(a)));
    dc.registerCommand('length',   run((...a) => Calendar.cmd.setLength(a)));

    dc.registerCommand('del', run((name) => Calendar.cmd.deleteTemplate(name)));
    dc.registerCommand('rm',  run((name) => Calendar.cmd.deleteEvent(name)));

    dc.registerCommand('rename', run((from, to) => Calendar.cmd.renameEvent(from, to)));
    dc.registerCommand('mv',     run((from, to) => Calendar.cmd.renameEvent(from, to)));

    dc.registerCommand('print', printDispatch);
    dc.registerCommand('list',  printDispatch);
    dc.registerCommand('ls',    printDispatch);

    dc.registerCommand('printall', run((kind) => {
        if (kind === 't')      Calendar.cmd.printAllTemplates();
        else if (kind === 'e') Calendar.cmd.printAllEvents();
        else throw new Calendar.ParseError(`unknown printall target: ${kind}`);
    }));

    dc.registerCommand('view', run((range) => Calendar.cmd.setView(range)));
    dc.registerCommand('time', run((range) => Calendar.cmd.setView(range)));

    dc.registerCommand('days', run((str) => Calendar.cmd.setDays(str)));
    dc.registerCommand('week', run((str) => Calendar.cmd.setDays(str))); // <--- NEW ALIAS
    
    dc.registerCommand('or',       run((...a) => Calendar.cmd.addOverride(a)));
    dc.registerCommand('override', run((...a) => Calendar.cmd.addOverride(a)));
    dc.registerCommand('restore', run((...a) => Calendar.cmd.restoreOverride(a)));
    dc.registerCommand('dump', () => {
        window.devConsole.prompt('are you sure you want to delete ALL data? y/n', (yes) => {
            if (yes) {
                Calendar.cmd.dumpAll();
                window.devConsole.print('all data dumped.', 'error');
            } else {
                window.devConsole.print('cancelled.');
            }
        });
    });
    // --- Help ---
    const HELP = {
        distance: [
            'distance <locA>-<locB> <h.m>',
            '',
            '  define or edit symmetric travel time between two locations.',
            '  minutes: 1 digit = tens; 2 digits = 00-55, multiples of 5.',
            '  example: distance dorm-fax 0.2',
        ].join('\n'),

        template: [
            'template <name> <location> <color> <duration>',
            '',
            '  define a reusable template for events.',
            '  color is a mandatory 3-digit hex without #.',
            '  duration uses time notation, e.g. 0.2 or a.5.',
            '  example: template temp2 fax 42f 0.4',
        ].join('\n'),

        add: [
            'add w<days>   <range> <location> <name> [color]',
            'add d<DDMMYY> <range> <location> <name> [color]',
            '',
            '  time: hour [1-12 | a|b|c] [.MM] [a|p]?',
            '  without a/p, 7..c are AM, 1..6 are PM.',
            '',
            '  examples:',
            '    add w2,5 2.5p-4p fax MRS',
            '    add d281126 3p-7.5p fax EXAM 555',
        ].join('\n'),

        addt: [
            'addt w<days>   <start> <template> <name>',
            'addt d<DDMMYY> <start> <template> <name>',
            '',
            '  like add, but duration, color, and location come from the template.',
            '  compact variant: t <days|date> <start> <template> <name>',
        ].join('\n'),

        a: [
            'a <days|date> <range> <location> <name> [color]',
            '',
            '  compact add. no template.',
            '  <days|date> can be sorted weekday digits (e.g. 135)',
            '              or DDMM / DDMMYY date (e.g. 1711).',
            '  if no color is provided, a random one is generated.',
            '',
            '  example: a 1711 b-c fax tens 256',
        ].join('\n'),

        t: [
            't <days|date> <start> <template> <name>',
            '',
            '  compact templated add.',
            '  <days|date> can be sorted weekday digits (e.g. 45)',
            '              or DDMM / DDMMYY date (e.g. 2811).',
            '',
            '  example: t 1410 b.35 temp2 ev7',
        ].join('\n'),

        length: [
            'length <event> <date> <duration>',
            '',
            '  override a templated event length on one date.',
            '  duration uses time notation, e.g. 0.25 or f.2.',
            '  example: length ev7 1410 0.25',
        ].join('\n'),

        item: [
            'item <template> + item1 item2 - item3',
            '',
            '  add/remove required items on a template.',
            '  + adds; - removes. conflicts prompt for y/n.',
        ].join('\n'),

        del: [
            'del <template>',
            '',
            '  delete a template.',
        ].join('\n'),

        rm: [
            'rm <event>',
            '',
            '  delete an event.',
        ].join('\n'),

        rename: [
            'rename <old> <new>',
            'mv     <old> <new>',
            '',
            '  rename an event.',
        ].join('\n'),

        print: [
            'print ev <name>',
            'print template <name>',
            'print distances',
            'list | ls    (aliases)',
            'printall t | printall e',
            '',
            '  display calendar data.',
        ].join('\n'),

        printall: [
            'printall t',
            'printall e',
            '',
            '  tabular dump of all templates / all events.',
        ].join('\n'),

        view: [
            'view <start>-<end>',
            '',
            '  set visible hour range. single-hour granularity, 0-24.',
            '  example: view 06-20',
        ].join('\n'),

        time: [
            'time <start>-<end>',
            '',
            '  set visible hour range. single-hour granularity, 0-24.',
            '  example: time 06-20  (alias for view)',
        ].join('\n'),

        days: [
            'days <days>',
            'week <days>     (alias)',
            '',
            '  set which weekdays are visible.',
            '  formats: 1357 (sorted list) or 1-4 (range).',
            '  example: days 1-5',
        ].join('\n'),

        or: [
            'or <date> [events...]',
            'override <date> [events...]',
            '',
            '  disable recurring events for specific dates.',
            '  <date> can be a single date (231227) or a range (231227-271227).',
            '  if no events are listed, it disables all current recurring events for that day.',
            '',
            '  examples:',
            '    or 231227           (disables everything on Wed, Dec 23)',
            '    or 231227 ev1 ev2   (disables only ev1 and ev2)',
            '    override 231227-271227',
        ].join('\n'),

        help: [
            'help [command]',
            '',
            '  list commands, or show help for a specific one.',
        ].join('\n'),

        restore: [
            'restore <date|range> [events...]',
            '',
            '  remove overrides for specific dates.',
            '  <date> can be a single date (231227) or a range (231227-271227).',
            '  if no events are listed, it removes all overrides for that day.',
            '',
            '  examples:',
            '    restore 231227           (restores everything on Wed, Dec 23)',
            '    restore 231227 ev1 ev3   (restores only ev1 and ev3)',
            '    restore 231227-271227',
        ].join('\n'),

        dump: [
            'dump',
            '',
            '  delete all calendar data.',
            '  wipes events, templates, distances, and overrides.',
        ].join('\n'),
    };
    

    dc.registerCommand('help', (...args) => {
        if (args.length === 0) {
            dc.print('available: ' + Object.keys(dc.commands).sort().join(', '));
            dc.print('try: help <command>');
            return;
        }
        let topic = args[0].toLowerCase();
        if (topic === 'mv') topic = 'rename';
        if (topic === 'list' || topic === 'ls') topic = 'print';
        const text = HELP[topic];
        if (!text) { dc.print(`no help for '${topic}'`, 'error'); return; }
        dc.print(text);
    });
    

    // --- Console hint ---
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            console.log('[system] console requested.');
        }
    });
});