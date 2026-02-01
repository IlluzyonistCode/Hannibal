const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const FLASK_PORT = 5000;
const FLASK_SERVER_URL = `http://127.0.0.1:${FLASK_PORT}`;

let pythonProcess = null;
let mainWindow = null;

function startPythonServer() {
    console.log('Attempting to start Python server...');

    const serverPath = path.join(__dirname, '..', 'server', 'app.py');

    if (!require('fs').existsSync(serverPath)) {
        console.error(`Server file not found at: ${serverPath}`);

        app.quit();

        return;
    }

    pythonProcess = spawn('python3', [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe']
    });

    pythonProcess.stdout.on('data', (data) => {
        console.log(`[Python Server]: ${data.toString().trim()}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`[Python Server Error]: ${data.toString().trim()}`);
    });

    pythonProcess.on('close', (code) => {
        console.log(`Python server process exited with code ${code}`);
        
        if (mainWindow) mainWindow.webContents.send('server-status', 'exited');
    });

    pythonProcess.on('error', (err) => {
        console.error('Failed to start Python server process:', err);

        if (mainWindow)  mainWindow.webContents.send('server-status', 'error');
    });
}

function killPythonServer() {
    if (pythonProcess) {
        console.log('Killing Python server process...');

        pythonProcess.kill('SIGTERM');
        pythonProcess = null;
    }
}

function checkServerReady(callback) {
    const client = net.createConnection({ port: FLASK_PORT }, () => {
        client.end();

        fetch(`${FLASK_SERVER_URL}/health`)
            .then(res => res.json())
            .then(data => {
                if (data.status === 'ok') callback(true);
                
                else callback(false);
            })
            .catch(() => callback(false));
    });

    client.on('error', () => {
        callback(false);
    });
}

function waitForServer(callback, attempts = 0) {
    const MAX_ATTEMPTS = 20;
    const DELAY_MS = 1000;

    if (attempts >= MAX_ATTEMPTS) {
        console.error('Server failed to start after multiple attempts.');

        callback(false);

        return;
    }

    checkServerReady((isReady) => {
        if (isReady) {
            console.log('Python server is ready.');

            callback(true);
        } else {
            console.log(`Waiting for server... Attempt ${attempts + 1}/${MAX_ATTEMPTS}`);
            
            setTimeout(() => waitForServer(callback, attempts + 1), DELAY_MS);
        }
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 1000,
        minHeight: 600,
        title: 'Hannibal',
        webPreferences: {
            preload: path.join(__dirname, 'renderer.js'),
            nodeIntegration: true,
            contextIsolation: false,
        },
        frame: true,
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#0f0f0f'
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    startPythonServer();

    waitForServer((isReady) => {
        if (isReady) createWindow();
        
        else app.quit();
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', (event) => killPythonServer());

ipcMain.on('get-server-url', (event) => {
    event.returnValue = FLASK_SERVER_URL;
});
