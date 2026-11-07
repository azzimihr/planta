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

    function animate() {
        mouseX += (targetX - mouseX) * 0.05;
        mouseY += (targetY - mouseY) * 0.05;
        const t = Date.now() * 0.001;

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

        requestAnimationFrame(animate);
    }
    animate();

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
    dc.registerCommand('addt',     run((...a) => Calendar.cmd.addTemplated(a)));
    dc.registerCommand('t',        run((...a) => Calendar.cmd.addTemplatedCompact(a)));
    dc.registerCommand('item',     run((...a) => Calendar.cmd.item(a)));

    dc.registerCommand('del', run((kind, name) => {
        if (kind === 'temp')     Calendar.cmd.deleteTemplate(name);
        else if (kind === 'ev')  Calendar.cmd.deleteEvent(name);
        else throw new Calendar.ParseError(`unknown del target: ${kind}`);
    }));

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
            'template <name> <location> [color]',
            '',
            '  define a reusable template for events.',
            '  color is optional 3-digit hex without #.',
            '  example: template subj fax ba0',
        ].join('\n'),

        add: [
            'add w<days>   <range> <name> <location> [color]',
            'add d<DDMMYY> <range> <name> <location> [color]',
            '',
            '  time: hour [1-12 | a|b|c] [.MM] [a|p]?',
            '  without a/p, 7..c are AM, 1..6 are PM.',
            '',
            '  examples:',
            '    add w2,5 2.5p-4p MRS fax',
            '    add d281126 3p-7.5p EXAM fax 555',
        ].join('\n'),

        addt: [
            'addt <template> w<days>   <range> <name> [color]',
            'addt <template> d<DDMMYY> <range> <name> [color]',
            '',
            '  like add, but location comes from the template.',
            '  compact variant: t <template> <days|date> <range> <name> [color]',
        ].join('\n'),

        t: [
            't <template> <compact> <range> <name> [color]',
            '',
            '  compact templated add.',
            '  <compact>: sorted weekday digits (4, 45, 137, 1234567)',
            '          or 6-digit DDMMYY date (281126).',
            '',
            '  example: t vezbe 45 b.4-1.1 ntp',
        ].join('\n'),

        item: [
            'item <template> + item1 item2 - item3',
            '',
            '  add/remove required items on a template.',
            '  + adds; - removes. conflicts prompt for y/n.',
        ].join('\n'),

        del: [
            'del temp <name>',
            'del ev <name>',
            '',
            '  delete a template or an event.',
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
        '',
        '  set which weekdays are visible.',
        '  formats: 1357 (list of sorted numbers) or 1-4 (range).',
        '  example: days 1-5',
        ].join('\n'),

        help: [
            'help [command]',
            '',
            '  list commands, or show help for a specific one.',
        ].join('\n'),
    };

    dc.registerCommand('help', (...args) => {
        if (args.length === 0) {
            dc.print('available: ' + Object.keys(dc.commands).sort().join(', '));
            dc.print('try: help <command>');
            return;
        }
        let topic = args[0].toLowerCase();
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