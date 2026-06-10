const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let db = null;

function initDb() {
    try {
        const Database = require('better-sqlite3');
        const dbPath = path.join(app.getPath('userData'), 'hannibal.db');

        db = new Database(dbPath);

        db.exec(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS lexicon (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                type        TEXT NOT NULL,
                content     TEXT NOT NULL,
                definition  TEXT,
                original    TEXT,
                context     TEXT,
                source      TEXT,
                language    TEXT,
                created_at  TEXT DEFAULT (datetime('now'))
            );
        `);

        return true;
    } catch (error) {
        console.error('DB init failed:', error.message);

        return false;
    }
}

function getSetting(key) {
    if (!db) return;

    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);

    return row ? row.value : null;
}

function setSetting(key, value) {
    if (!db) return;

    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

ipcMain.handle('settings:get-all', () => {
    return {
        model: getSetting('model') || 'openai/gpt-4o',
        language: getSetting('language') || 'Russian',
        temp: parseFloat(getSetting('temp') || '0.8'),
        store: getSetting('store') !== 'false'
    };
});

ipcMain.handle('settings:save', (_, payload) => {
    if (payload.model !== undefined) setSetting('model', payload.model);
    if (payload.language !== undefined) setSetting('language', payload.language);
    if (payload.temp !== undefined) setSetting('temp', String(payload.temp));
    if (payload.store !== undefined) setSetting('store', String(payload.store));

    return true;
});

ipcMain.handle('settings:get-key', () => {
    const enc = getSetting('api_key_enc');

    if (!enc) return '';

    try {
        if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(enc, 'base64'));

        return Buffer.from(enc, 'base64').toString('utf8');
    } catch {
        return '';
    }
});

ipcMain.handle('settings:save-key', (_, key) => {
    let stored;

    if (safeStorage.isEncryptionAvailable()) stored = safeStorage.encryptString(key).toString('base64');
    
    else stored = Buffer.from(key).toString('base64');

    setSetting('api_key_enc', stored);

    return true;
});

ipcMain.handle('ai:call', async (_, { messages, temperature }) => {
    const key = await ipcMain.emit;

    const enc = getSetting('api_key_enc');

    if (!enc) return { error: 'No API key configured.' };

    let apiKey;

    try {
        if (safeStorage.isEncryptionAvailable()) apiKey = safeStorage.decryptString(Buffer.from(enc, 'base64'));
        
        else apiKey = Buffer.from(enc, 'base64').toString('utf8');
    } catch {
        return { error: 'Failed to decrypt API key.' };
    }

    const model = getSetting('model') || 'openai/gpt-4o';
    const temp = parseFloat(getSetting('temp') || '0.8');

    try {
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://hannibal-app.local',
                'X-Title': 'Hannibal'
            },
            body: JSON.stringify({
                model,
                temperature: temperature !== undefined ? temperature : temp,
                messages
            }),
        });

        if (!resp.ok) {
            const txt = await resp.text();

            return { error: `API error ${resp.status}: ${txt.slice(0, 200)}` };
        }

        const data = await resp.json();

        return { content: data.choices[0].message.content };
    } catch (error) {
        return { error: error.message };
    }
});

ipcMain.handle('lexicon:list', (_, { search, lang } = {}) => {
    if (!db) return [];

    let sql = 'SELECT * FROM lexicon WHERE 1=1';
    const params = [];

    if (search) {
        sql += ' AND (content LIKE ? OR definition LIKE ?)';

        params.push(`%${search}%`, `%${search}%`);
    }

    if (lang && lang !== 'all') {
        sql += ' AND language = ?';

        params.push(lang);
    }

    sql += ' ORDER BY created_at DESC';

    return db.prepare(sql).all(...params);
});

ipcMain.handle('lexicon:add', (_, entry) => {
    if (!db) return;

    const store = getSetting('store');

    if (store === 'false') return { skipped: true };

    const lang = entry.language || detectLanguage(entry.content || '');

    const result = db.prepare(`
        INSERT INTO lexicon (type, content, definition, original, context, source, language)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        entry.type,
        entry.content,
        entry.definition || '',
        entry.original || '',
        entry.context || '',
        entry.source || '',
        lang
    );

    return { id: result.lastInsertRowid };
});

ipcMain.handle('lexicon:delete', (_, id) => {
    if (!db) return;

    db.prepare('DELETE FROM lexicon WHERE id = ?').run(id);

    return true;
});

ipcMain.handle('lexicon:update', (_, { id, content, definition }) => {
    if (!db) return;

    db.prepare('UPDATE lexicon SET content = ?, definition = ? WHERE id = ?')
        .run(content, definition, id);

    return true;
});

ipcMain.handle('lexicon:export', async () => {
    if (!db) return;

    const rows = db.prepare('SELECT * FROM lexicon ORDER BY created_at DESC').all();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const json = JSON.stringify(rows, null, 2);

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: `hannibal-lexicon-${ts}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (filePath) {
        fs.writeFileSync(filePath, json, 'utf8');

        return true;
    }

    return false;
});

ipcMain.handle('lexicon:import', async () => {
    if (!db) return 0;

    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
    });

    if (!filePaths[0]) return 0;

    const rows = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));

    let added = 0;

    const insert = db.prepare(`
        INSERT OR IGNORE INTO lexicon (type, content, definition, original, context, source, language, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const r of rows) {
        insert.run(r.type, r.content, r.definition, r.original, r.context, r.source, r.language, r.created_at);

        added++;
    }

    return added;
});

ipcMain.handle('lexicon:clear-all', () => {
    if (!db) return;

    db.prepare('DELETE FROM lexicon').run();

    return true;
});

ipcMain.handle('lexicon:languages', () => {
    if (!db) return [];

    return db.prepare('SELECT DISTINCT language FROM lexicon WHERE language IS NOT NULL ORDER BY language').all().map(r => r.language);
});

function detectLanguage(text) {
    if (/[\u4e00-\u9fff]/.test(text)) return 'Chinese';
    if (/[\u0600-\u06ff]/.test(text)) return 'Arabic';
    if (/[\u0400-\u04ff]/.test(text)) return 'Russian';
    if (/[äöüßÄÖÜ]/.test(text)) return 'German';
    if (/[àâçéèêëîïôùûüÿæœ]/.test(text)) return 'French';
    if (/[áéíóúüñ¡¿]/.test(text)) return 'Spanish';
    if (/[àèéìíîòóùú]/.test(text)) return 'Italian';
    if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(text)) return 'Polish';
    if (/[şğıİŞĞÜÖÇ]/.test(text)) return 'Turkish';

    return 'English';
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 840,
        minWidth: 1024,
        minHeight: 700,
        title: 'Hannibal',
        backgroundColor: '#0f0f0f',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        frame: true,
        titleBarStyle: 'hiddenInset'
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
    initDb();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
