// public/extensions/third-party/starK/index.js (服务器端 - 由 SillyTavern plugin-loader 加载)
import { fork } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises'; // fs/promises is fine here as this runs in Node
import { fileURLToPath } from 'node:url'; // To get __dirname equivalent in ES modules

let localServerProcess = null;
const localServerPort = 3001; // 必须与 local-server/server.js 中的 PORT 一致

export const info = {
    id: 'stark', // 必须与 manifest.json 中的 "id" 匹配
    name: 'StarK Plugin with Local Server',
    description: 'Manages a local helper server for extended file access to display last messages.',
};

// 获取当前模块文件的目录路径
function getCurrentModuleDirectory() {
    try {
        // ES Module standard way
        return path.dirname(fileURLToPath(import.meta.url));
    } catch (e) {
        console.warn(`[${info.id} Plugin] Could not determine module path using import.meta.url. This might affect local server startup if the fallback path is incorrect. Error: ${e.message}`);
        // Fallback, less reliable, assumes execution context or specific SillyTavern behavior
        // This path needs to correctly point to the 'starK' plugin directory
        return path.join(process.cwd(), 'public', 'extensions', 'third-party', 'starK');
    }
}

export async function init(router) { // router 是 SillyTavern plugin-loader 传入的
    console.log(`[${info.id} Plugin] Initializing SillyTavern-side component...`);

    const currentPluginDir = getCurrentModuleDirectory();
    const scriptToFork = path.resolve(currentPluginDir, 'local-server', 'server.js');

    // 确定 SillyTavern 的 DATA_ROOT 路径
    const dataRootForChild = globalThis.DATA_ROOT || path.resolve(process.cwd(), 'data');
    if (!globalThis.DATA_ROOT) {
        console.warn(`[${info.id} Plugin] globalThis.DATA_ROOT is not set. Falling back to CWD/data: ${dataRootForChild}. This might be incorrect if SillyTavern uses a custom data root.`);
    }

    try {
        await fs.access(scriptToFork); // 检查本地服务器脚本是否存在
        console.log(`[${info.id} Plugin] Found local server script at: ${scriptToFork}`);
        console.log(`[${info.id} Plugin] Will pass DATA_ROOT to local server: ${dataRootForChild}`);

        if (localServerProcess && !localServerProcess.killed) {
            console.log(`[${info.id} Plugin] Local server process seems to be already running (PID: ${localServerProcess.pid}). Not starting a new one.`);
        } else {
            localServerProcess = fork(
                scriptToFork,
                [dataRootForChild], // Pass DATA_ROOT as an argument
                {
                    silent: false, // Set to true to pipe child's stdio to parent's, false to let child use its own.
                                  // For debugging, 'false' can be easier to see child's direct console logs.
                }
            );

            localServerProcess.on('message', (message) => {
                if (typeof message === 'object' && message !== null) {
                    console.log(`[${info.id} Plugin] Message from local server: Type: ${message.type}, Content: ${message.message}`);
                    if (message.type === 'STATUS' && message.message === 'SERVER_READY') {
                        console.log(`[${info.id} Plugin] Confirmed: Local helper server is ready on port ${message.port || localServerPort}.`);
                    } else if (message.type === 'ERROR') {
                        console.error(`[${info.id} Plugin] Error reported from local server: ${message.message} (Code: ${message.code})`);
                        // Potentially kill the process if it reported a startup error but didn't exit
                        if (localServerProcess && !localServerProcess.killed && message.code === 'EADDRINUSE') {
                             console.warn(`[${info.id} Plugin] Local server reported EADDRINUSE. Assuming another instance is running or port is taken.`);
                             // Don't kill, let the other instance (if any) handle requests. Or implement smarter logic.
                        }
                    }
                } else {
                     console.log(`[${info.id} Plugin] Raw message from local server:`, message);
                }
            });

            localServerProcess.on('error', (err) => {
                console.error(`[${info.id} Plugin] Failed to start local server process OR local server process emitted an error:`, err);
                localServerProcess = null; // Clear the reference
            });

            localServerProcess.on('exit', (code, signal) => {
                console.log(`[${info.id} Plugin] Local server process (PID: ${localServerProcess?.pid}) exited with code ${code} and signal ${signal}.`);
                localServerProcess = null; // Clear the reference
            });

            console.log(`[${info.id} Plugin] Local server process forked (PID: ${localServerProcess.pid}). Waiting for it to become ready...`);
            // It's better to wait for 'SERVER_READY' message than a fixed timeout
        }
    } catch (error) {
        console.error(`[${info.id} Plugin] Could not start local server. Script not found at ${scriptToFork} or other error:`, error);
    }

    // Optional: A SillyTavern-proxied API endpoint (if needed for other things, or as a fallback)
    router.get('/ping-st', (req, res) => {
        console.log(`[${info.id} Plugin API via SillyTavern] /ping-st hit!`);
        const isLocalRunning = localServerProcess !== null && !localServerProcess.killed;
        res.json({
            message: `Pong from ${info.name} (SillyTavern plugin part)!`,
            localServerExpectedPort: localServerPort,
            isLocalServerProcessAlive: isLocalRunning,
        });
    });

    console.log(`[${info.id} Plugin] SillyTavern-side init completed. Local server (if started) PID: ${localServerProcess?.pid}`);
}

export async function exit() {
    console.log(`[${info.id} Plugin] Exiting SillyTavern plugin component... Attempting to stop local server (PID: ${localServerProcess?.pid}).`);
    if (localServerProcess && !localServerProcess.killed) {
        console.log(`[${info.id} Plugin] Sending SIGTERM to local server process PID ${localServerProcess.pid}.`);
        const killed = localServerProcess.kill('SIGTERM'); // Try to gracefully terminate
        if (killed) {
            console.log(`[${info.id} Plugin] SIGTERM signal sent to local server.`);
            // Give it a moment to shut down before force killing, if necessary
            await new Promise(resolve => setTimeout(resolve, 500));
            if (localServerProcess && !localServerProcess.killed) {
                console.log(`[${info.id} Plugin] Local server did not exit after SIGTERM, sending SIGKILL.`);
                localServerProcess.kill('SIGKILL');
            }
        } else {
            console.error(`[${info.id} Plugin] Failed to send SIGTERM to local server process.`);
        }
    } else {
        console.log(`[${info.id} Plugin] No active local server process to stop.`);
    }
    localServerProcess = null;
}
