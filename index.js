// public/extensions/third-party/starK/index.js (服务器端脚本)
import fs from 'node:fs/promises';
import path from 'node:path';   
// 注意：这里不再需要 import express from 'express'; 因为 router 是被传入的

// 插件信息 - 必须与 manifest.json 中的 id 匹配或相关
export const info = {
    id: 'stark', // **重要：必须与 manifest.json 中的 id 匹配，用于API路径**
    name: 'StarK Last Messages API',
    description: 'Provides an API to get the last message of each chat for a character.',
};

// 插件初始化函数 - 会接收一个 Express Router 实例
export async function init(router) {
    console.log(`[${info.id} Plugin] Initializing server-side routes...`);

    router.post('/get-character-last-messages', async (req, res) => {
        const { character_avatar } = req.body;

        if (!character_avatar) {
            return res.status(400).json({ success: false, error: 'character_avatar is required.' });
        }

        const chatLastMessages = [];
        try {
            const dataRootDir = globalThis.DATA_ROOT || process.cwd();
            const characterDirName = character_avatar.replace(/\.(png|webp|gif|jpeg|jpg)$/i, '');
            // 确认路径: DATA_ROOT/chats/CharacterDirName/
            const characterChatsPath = path.join(dataRootDir, 'chats', characterDirName);

            let filesInDir = [];
            try {
                filesInDir = await fs.readdir(characterChatsPath);
            } catch (dirError) {
                if (dirError.code === 'ENOENT') {
                    console.log(`[${info.id} Plugin API] Directory not found for ${character_avatar}: ${characterChatsPath}`);
                    return res.json({ success: true, chatLastMessages: [] });
                }
                console.error(`[${info.id} Plugin API] Error reading directory ${characterChatsPath}:`, dirError);
                return res.status(500).json({ success: false, error: 'Failed to read character chat directory.' });
            }

            const chatFiles = filesInDir.filter(file => file.endsWith('.jsonl'));

            for (const chatFile of chatFiles) {
                const filePath = path.join(characterChatsPath, chatFile);
                try {
                    const fileContent = await fs.readFile(filePath, 'utf-8');
                    const lines = fileContent.split('\n').filter(line => line.trim() !== '');

                    if (lines.length > 1) {
                        const lastMessageLine = lines[lines.length - 1];
                        const lastMessage = JSON.parse(lastMessageLine);
                        chatLastMessages.push({
                            chatFileName: path.basename(chatFile, '.jsonl'),
                            lastMessage: lastMessage
                        });
                    }
                } catch (fileReadError) {
                    console.error(`[${info.id} Plugin API] Error reading or parsing file ${chatFile} for ${character_avatar}:`, fileReadError.message);
                }
            }

            chatLastMessages.sort((a, b) => (b.lastMessage?.send_date || 0) - (a.lastMessage?.send_date || 0));
            res.json({ success: true, chatLastMessages });

        } catch (error) {
            console.error(`[${info.id} Plugin API] Error in /get-character-last-messages:`, error);
            res.status(500).json({ success: false, error: 'Internal server error.' });
        }
    });

    router.get('/ping', (req, res) => {
        console.log(`[${info.id} Plugin API] /ping hit!`);
        res.send(`Pong from ${info.name}!`);
    });

    console.log(`[${info.id} Plugin] Server-side routes registered for /api/plugins/${info.id}`);
}

// (可选) 插件退出时的清理函数
// export async function exit() {
// console.log(`[${info.id} Plugin] Exiting...`);
// }

// 使用 export default 如果 plugin-loader 优先检查 default
// export default { info, init };
