/* --- Firebase calendar import/export --- */

Calendar.firebase = (() => {
    let CONFIG = null;
    let app = null;
    let auth = null;
    let database = null;

    async function loadConfig() {
        if (CONFIG) return CONFIG;
        if (window.AIO_FIREBASE_CONFIG) {
            CONFIG = window.AIO_FIREBASE_CONFIG;
        } else if (window.location.protocol === 'file:') {
            CONFIG = await loadLocalConfigFile();
        } else {
            const response = await fetch('firebase-config.json', { cache: 'no-store' });
            if (!response.ok) throw new Error('Firebase config file is missing');
            CONFIG = await response.json();
        }
        if (!CONFIG.apiKey || !CONFIG.databaseURL || !CONFIG.projectId)
            throw new Error('Firebase config is incomplete');
        if (Object.values(CONFIG).some(value =>
            typeof value === 'string' && value.startsWith('REPLACE_WITH_')
        )) throw new Error('Firebase config is not set');
        return CONFIG;
    }

    function loadLocalConfigFile() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/json,.json';
            input.addEventListener('change', () => {
                const file = input.files && input.files[0];
                if (!file) {
                    reject(new Error('Firebase config selection cancelled'));
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        resolve(JSON.parse(reader.result));
                    } catch (error) {
                        reject(new Error('Firebase config is invalid JSON'));
                    }
                };
                reader.onerror = () => reject(new Error('Could not read Firebase config'));
                reader.readAsText(file);
            }, { once: true });
            input.click();
        });
    }

    async function ensure() {
        const config = await loadConfig();
        if (!window.firebase) throw new Error('Firebase SDK failed to load');
        if (!app) {
            app = firebase.initializeApp(config);
            auth = firebase.auth();
            database = firebase.database();
        }
        return { auth, database };
    }

    function login() {
        return ensure().then(({ auth }) => {
            const email = window.prompt('Firebase email');
            if (!email) return false;
            const password = window.prompt('Firebase password');
            if (!password) return false;
            return auth.signInWithEmailAndPassword(email, password)
                .then(() => true);
        });
    }

    function requireUser() {
        return ensure().then(({ auth }) => {
            return auth.currentUser
                ? auth.currentUser
                : login().then(() => auth.currentUser);
        });
    }

    function exportState() {
        return ensure().then(({ database }) => {
            return requireUser().then(user => {
                if (!user) throw new Error('Firebase login cancelled');
                const state = Calendar.normalizeState(Calendar.getState());
                Calendar.replaceState(state);
                Calendar.save();
                return database.ref('calendar').set(state);
            });
        });
    }

    function importState() {
        return ensure().then(({ database }) => {
            return requireUser().then(user => {
                if (!user) throw new Error('Firebase login cancelled');
                return database.ref('calendar').once('value').then(snapshot => {
                    const incoming = snapshot.val();
                    if (!incoming || incoming.version !== Calendar.VERSION)
                        throw new Error('bad Firebase calendar data');
                    const normalized = Calendar.normalizeState(incoming);
                    Calendar.replaceState(normalized);
                    Calendar.save();
                    Calendar.render.render();
                });
            });
        });
    }

    function logout() {
        if (auth) return auth.signOut();
        return Promise.resolve();
    }

    return { exportState, importState, login, logout };
})();
