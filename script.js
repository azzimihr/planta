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

    // Track mouse globally
    window.addEventListener('mousemove', (e) => {
        targetX = (e.clientX / window.innerWidth - 0.5) * 1.5;
        targetY = (e.clientY / window.innerHeight - 0.5) * 1.5;
    });

    // Setup each shard
    shards.forEach((shard, i) => {
        shard.dataset.offset = i * 2.5; 
        shard.dataset.hover = 'false';
        
        // Read your CSS variable --rot to keep your layout angles
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
        // Smooth mouse interpolation for buttery parallax
        mouseX += (targetX - mouseX) * 0.05;
        mouseY += (targetY - mouseY) * 0.05;
        
        const t = Date.now() * 0.001; 

        shards.forEach(shard => {
            const offset = parseFloat(shard.dataset.offset);
            const hovered = shard.dataset.hover === 'true';
            const baseRot = parseFloat(shard.dataset.baseRot);

            // 1. Organic Base Floating (X, Y, and Rotation drift independently)
            const floatX = Math.sin(t * 1.3 + offset) * 15;  
            const floatY = Math.cos(t * 1.7 + offset) * 20;  
            const floatRot = Math.sin(t * 1 + offset) * 10; 

            // 2. Global Mouse Parallax (Subtle depth)
            const parX = mouseX * -45; 
            const parY = mouseY * -45;

            // 3. Active Hover Animation (Smooth, slow, breathing)
            let targetScale = hovered ? 1.5 : 1.0;
            
            // Slower frequency for a gentle wobble, not a shake
            let hoverWobble = hovered ? Math.sin(t * 3) * 1.5 : 0; 
            let hoverPulse = hovered ? Math.sin(t * 2) * 0.01 : 0; 

            // Smoothly interpolate scale so it doesn't snap
            shard.dataset.currentScale = parseFloat(shard.dataset.currentScale) + (targetScale - parseFloat(shard.dataset.currentScale)) * 0.15;
            const currentScale = parseFloat(shard.dataset.currentScale) + hoverPulse;

            // Combine into one smooth transform
            const finalRot = baseRot + floatRot + hoverWobble;
            shard.style.transform = `translate3d(${floatX + parX}px, ${floatY + parY}px, 0) rotate(${finalRot}deg) scale(${currentScale})`;
        });

        // Floaty Background Shapes (Slower parallax for depth)
        shapes.forEach((shape, i) => {
            const speed = (i + 1) * 25;
            const rot = t * (i + 1) * 4;
            shape.style.transform = `translate3d(${mouseX * speed}px, ${mouseY * speed}px, 0) rotate(${rot}deg)`;
        });

        requestAnimationFrame(animate);
    }

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

    dc.registerCommand('distance', run((pair, dist) => Calendar.cmd.addDistance(pair, dist)));
    dc.registerCommand('template', run((...a) => Calendar.cmd.addTemplate(a)));
    dc.registerCommand('add',      run((...a) => Calendar.cmd.addEvent(a)));
    dc.registerCommand('addt',     run((...a) => Calendar.cmd.addTemplated(a)));
    dc.registerCommand('delete',   run((kind, name) => {
        if (kind === 'template') Calendar.cmd.deleteTemplate(name);
        else if (kind === 'event') Calendar.cmd.deleteEvent(name);
        else throw new Calendar.ParseError(`unknown delete target: ${kind}`);
    }));
    dc.registerCommand('print', run((kind, name) => {
        if (kind === 'ev') Calendar.cmd.printEvent(name);
        else if (kind === 'template') Calendar.cmd.printTemplate(name);
        else if (kind === 'distances') Calendar.cmd.printDistances();
        else throw new Calendar.ParseError(`unknown print target: ${kind}`);
    }));
    dc.registerCommand('view', run((range) => Calendar.cmd.setView(range)));

    // --- Help system ---
    const HELP = {
        distance: [
            'distance <locA>-<locB> <h.m>',
            '',
            '  define symmetric travel time between two locations.',
            '  the .m part is tens-of-minutes, so 0.2 = 20 minutes.',
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
            '  w-variant: weekly repeating event. days is comma-separated 1-7 (mon=1).',
            '  d-variant: single dated event.',
            '  range like 2.5p-4p or 11a-1p.',
            '  color is optional 3-digit hex without #.',
            '',
            '  examples:',
            '    add w2,5 2.5p-4p MRS fax',
            '    add d281126 3p-7.5p EXAM fax 555',
        ].join('\n'),

        addt: [
            'addt <template> w<days>   <range> <name> [color]',
            'addt <template> d<DDMMYY> <range> <name> [color]',
            '',
            '  like add, but pulls location (and color) from a template.',
            '  event color overrides template color when both present.',
            '',
            '  examples:',
            '    addt subj w2,5 2.5p-4p MRS',
            '    addt subj w3 1p-2.5p LAB f0f',
        ].join('\n'),

        delete: [
            'delete template <name>',
            'delete event <name>',
            '',
            '  delete a template (events keep effective attributes)',
            '  or a single event.',
        ].join('\n'),

        print: [
            'print ev <name>',
            'print template <name>',
            'print distances',
            '',
            '  display calendar data.',
        ].join('\n'),

        view: [
            'view <start>-<end>',
            '',
            '  set visible hour range. single-hour granularity, 0-24.',
            '  example: view 06-20',
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
        const topic = args[0].toLowerCase();
        const text = HELP[topic];
        if (!text) { dc.print(`no help for '${topic}'`, 'error'); return; }
        dc.print(text);
    });
    
    animate();

    // Console Hint
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') { 
            e.preventDefault(); 
            console.log('[system] console requested.'); 
        }
    });
});