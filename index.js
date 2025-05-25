// starK/api.js (简化测试版)
import express from 'express';
const router = express.Router();

router.post('/get-character-last-messages', (req, res) => {
    console.log('[StarK API Test] /get-character-last-messages hit!');
    res.json({ success: true, message: "API endpoint reached successfully!", chatLastMessages: [] });
});

// 测试一个 GET 路由，方便浏览器直接访问测试
router.get('/ping', (req, res) => {
    console.log('[StarK API Test] /ping hit!');
    res.send('Pong from StarK API!');
});

export default router;
