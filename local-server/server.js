// public/extensions/third-party/starK/local-server/server.js
// 使用 require 以确保在子进程中模块解析的稳定性，尽管父进程可能用 import
const express = require('express');
const cors = require('cors');
const fs = require('node:fs/promises');
const path = require('node:path');

const app = express();
const PORT = 3001; // 与主插件中配置的端口一致

// 从父进程获取 SillyTavern 的 DATA_ROOT 路径
const SILLYTAVERN_DATA_ROOT_FROM_PARENT = process.argv[2];

if (!SILLYTAVERN_DATA_ROOT_FROM_PARENT) {
    const errMsg = '[LocalServer for StarK] CRITICAL: SillyTavern DATA_ROOT path not received from parent process. Cannot start.';
    console.error(errMsg);
    // 如果父进程可以接收消息，可以尝试发送错误消息
    if (process.send) {
        process.send({ type: 'ERROR', message: errMsg });
    }
    process.exit(1); // 必须退出，否则无法工作
}

const dataRootDir = path.resolve(SILLYTAVERN_DATA_ROOT_FROM_PARENT);
console.log(`[LocalServer for StarK] Successfully received DATA_ROOT from parent: ${dataRootDir}`);

// 只允许来自 SillyTavern 前端的请求 (通常是 http://127.0.0.1:8000)
app.use(cors({ origin: ['http://127.0.0.1:8000', 'http://localhost:8000'] }));
app.use(express.json());

app.post('/get-character-last-messages', async (req, res) => {
    const { character_avatar } = req.body;
    if (!character_avatar) {
        return res.status(400).json({ success: false, error: 'character_avatar is required.' });
    }

    const chatLastMessages = [];
    try {
        const characterDirName = character_avatar.replace(/\.(png|webp|gif|jpeg|jpg)$/i, '');
        const characterChatsPath = path.join(dataRootDir, 'chats', characterDirName);

        console.log(`[LocalServer for StarK] API: Reading from character path: ${characterChatsPath}`);

        let filesInDir = [];
        try {
            filesInDir = await fs.readdir(characterChatsPath);
        } catch (dirError) {
            if (dirError.code === 'ENOENT') {
                console.log(`[LocalServer for StarK] API: Directory not found: ${characterChatsPath}`);
                return res.json({ success: true, chatLastMessages: [] }); // 目录不存在是正常情况
            }
            console.error(`[LocalServer for StarK] API: Error reading directory ${characterChatsPath}:`, dirError);
            return res.status(500).json({ success: false, error: 'Failed to read character chat directory.' });
        }

        const chatFiles = filesInDir.filter(file => file.endsWith('.jsonl'));

        for (const chatFile of chatFiles) {
            const filePath = path.join(characterChatsPath, chatFile);
            try {
                const fileContent = await fs.readFile(filePath, 'utf-8');
                const lines = fileContent.split('\n').filter(line => line.trim() !== '');

                if (lines.length > 1) { // 至少1行元数据 + 1行消息
                    const lastMessageLine = lines[lines.length - 1];
                    const lastMessage = JSON.parse(lastMessageLine);
                    chatLastMessages.push({
                        chatFileName: path.basename(chatFile, '.jsonl'),
                        lastMessage: lastMessage
                    });
                }
            } catch (fileReadError) {
                console.error(`[LocalServer for StarK] API: Error reading/parsing file ${filePath}:`, fileReadError.message);
            }
        }

        chatLastMessages.sort((a, b) => (b.lastMessage?.send_date || 0) - (a.lastMessage?.send_date || 0));
        res.json({ success: true, chatLastMessages });

    } catch (error) {
        console.error('[LocalServer for StarK] API: Unhandled error in /get-character-last-messages:', error);
        res.status(500).json({ success: false, error: 'Internal server error on local helper.' });
    }
});

app.get('/ping-local', (req, res) => {
    console.log('[LocalServer for StarK] Ping received');
    res.status(200).json({ success: true, message: 'Pong from StarK Local Helper Server' });
});

const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`[LocalServer for StarK] Running on http://127.0.0.1:${PORT}`);
    console.log(`[LocalServer for StarK] Using SillyTavern DATA_ROOT: ${dataRootDir}`);
    if (process.send) {
        process.send({ type: 'STATUS', message: 'SERVER_READY', port: PORT });
    }
});

server.on('error', (err) => {
    const errorMsg = `[LocalServer for StarK] Failed to start on port ${PORT}. Error: ${err.message}`;
    console.error(errorMsg);
    if (err.code === 'EADDRINUSE') {
        console.error(`[LocalServer for StarK] Port ${PORT} is already in use. Another instance might be running or another application is using this port.`);
    }
    if (process.send) {
        process.send({ type: 'ERROR', message: errorMsg, code: err.code });
    }
    process.exit(1); // 如果服务器启动失败，子进程也应该退出
});
