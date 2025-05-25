// public/extensions/third-party/star/api.js
import express from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

router.post('/get-character-last-messages', async (req, res) => {
    const { character_avatar } = req.body;

    if (!character_avatar) {
        return res.status(400).json({ success: false, error: 'character_avatar is required.' });
    }

    const chatLastMessages = [];
    try {
        // 确定用户数据根目录
        const dataRootDir = globalThis.DATA_ROOT || process.cwd();
        // 角色聊天目录通常是 DATA_ROOT/chats/角色头像名(无扩展名)/
        const characterDirName = character_avatar.replace(/\.(png|webp|gif|jpeg|jpg)$/i, '');
        const characterChatsPath = path.join(dataRootDir, 'chats', characterDirName);

        let filesInDir = [];
        try {
            filesInDir = await fs.readdir(characterChatsPath);
        } catch (dirError) {
            if (dirError.code === 'ENOENT') {
                console.log(`[Star Plugin API] Directory not found for ${character_avatar}: ${characterChatsPath}`);
                return res.json({ success: true, chatLastMessages: [] });
            }
            console.error(`[Star Plugin API] Error reading directory ${characterChatsPath}:`, dirError);
            return res.status(500).json({ success: false, error: 'Failed to read character chat directory.' });
        }

        const chatFiles = filesInDir.filter(file => file.endsWith('.jsonl'));

        for (const chatFile of chatFiles) {
            const filePath = path.join(characterChatsPath, chatFile);
            try {
                const fileContent = await fs.readFile(filePath, 'utf-8');
                // 按行分割，并移除可能的空行
                const lines = fileContent.split('\n').filter(line => line.trim() !== '');

                if (lines.length > 1) { // 必须至少有一行元数据和一行消息
                    const lastMessageLine = lines[lines.length - 1];
                    const lastMessage = JSON.parse(lastMessageLine);
                    chatLastMessages.push({
                        chatFileName: path.basename(chatFile, '.jsonl'),
                        lastMessage: lastMessage
                    });
                }
            } catch (fileReadError) {
                console.error(`[Star Plugin API] Error reading or parsing file ${chatFile} for ${character_avatar}:`, fileReadError.message);
                // 跳过这个文件，继续处理其他文件
            }
        }

        // 按最后消息的发送日期降序排序 (最新的在前)
        chatLastMessages.sort((a, b) => {
            const timeA = a.lastMessage?.send_date || 0;
            const timeB = b.lastMessage?.send_date || 0;
            return timeB - timeA;
        });

        res.json({ success: true, chatLastMessages });

    } catch (error) {
        console.error('[Star Plugin API] Error in /get-character-last-messages:', error);
        res.status(500).json({ success: false, error: 'Internal server error.' });
    }
});

export default router;
