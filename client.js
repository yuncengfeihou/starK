// public/extensions/third-party/starK/client.js (前端脚本)
import {
    getContext,
    renderExtensionTemplateAsync,
} from '../../../extensions.js';

import {
    Popup,
    POPUP_TYPE,
} from '../../../popup.js';

import {
    messageFormatting,
    openCharacterChat,
} from '../../../../script.js';

import {
    timestampToMoment,
} from '../../../utils.js';

// 这个名字应该与你的插件文件夹名称完全一致
const pluginFolderName = 'starK';
// 这个ID应该与你的 manifest.json 文件中的 "id" 字段完全一致
const pluginManifestId = 'stark'; // 重要：确保与 manifest.json 中的 "id" 匹配

/**
 * 调用后端 API 获取当前角色所有聊天的最后一条消息
 */
async function fetchCharacterLastMessagesFromServer() {
    const context = getContext();
    if (!context) {
        toastr.error('无法获取SillyTavern上下文。');
        return null;
    }

    if (context.groupId || context.characterId === undefined) {
        toastr.info('请先选择一个角色。此功能当前仅支持角色，不支持群组。');
        return null;
    }

    const character = context.characters[context.characterId];
    if (!character || !character.avatar) {
        toastr.error('无法获取当前选定角色的信息或头像。');
        return null;
    }

    const apiUrl = `/api/plugins/${pluginManifestId}/get-character-last-messages`;

    console.log(`[${pluginFolderName}] Fetching last messages from: ${apiUrl} for avatar: ${character.avatar}`);

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(context.getRequestHeaders ? context.getRequestHeaders() : {}), // 获取包含 CSRF Token 的 Headers
            },
            body: JSON.stringify({ character_avatar: character.avatar })
        });

        if (!response.ok) {
            let errorMsg = `HTTP error! Status: ${response.status}`;
            try {
                const errorData = await response.json();
                errorMsg = errorData.error || errorMsg;
                console.error(`[${pluginFolderName}] API Error Data:`, errorData);
            } catch (e) {
                const textError = await response.text();
                console.error(`[${pluginFolderName}] API Error Text:`, textError);
                errorMsg += ` - ${textError.substring(0,100)}`;
            }
            throw new Error(errorMsg);
        }
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'API请求未成功，但未返回具体错误信息。');
        }
        console.log(`[${pluginFolderName}] Successfully fetched last messages:`, data.chatLastMessages);
        return data.chatLastMessages;
    } catch (error) {
        console.error(`[${pluginFolderName}] 获取角色末尾消息时发生错误:`, error);
        toastr.error(`获取角色末尾消息失败: ${error.message}`);
        return null;
    }
}

/**
 * 显示包含角色所有聊天末尾消息的 Popup
 * @param {Array} chatItems - 从后端获取的聊天条目数组
 */
function showLastMessagesPopup(chatItems) {
    const context = getContext();
    if (!context || context.characterId === undefined || !context.characters[context.characterId]) {
        toastr.error('无法获取当前角色信息以显示弹窗。');
        return;
    }
    const characterName = context.characters[context.characterId]?.name || '当前角色';

    let popupTitle = `${characterName} - 末尾消息`;
    let contentHtml = `<div id="character-last-messages-popup" style="max-height: 70vh; overflow-y: auto; padding: 10px;">`;
    contentHtml += `<h3>${characterName} - 所有聊天的末尾消息</h3>`;

    if (!chatItems || chatItems.length === 0) {
        contentHtml += `<p>该角色没有聊天记录，或者未能从服务器获取到任何聊天的最后一条消息。</p>`;
    } else {
        contentHtml += `<p style="font-size:0.9em; color: #aaa;">共找到 ${chatItems.length} 个聊天记录。列表按最新消息排序。</p><hr>`;
        contentHtml += `<ul style="list-style: none; padding: 0;">`;

        chatItems.forEach(item => {
            const { chatFileName, lastMessage } = item;
            const sender = lastMessage.name || (lastMessage.is_user ? (context.name1 || 'User') : (characterName || 'Character'));
            let messagePreview = '(空消息)';
            if (lastMessage.mes) {
                const tempDiv = document.createElement('div');
                // 确保 messageFormatting 被正确调用
                try {
                    tempDiv.innerHTML = messageFormatting(
                        lastMessage.mes,
                        sender,
                        !!lastMessage.is_system, // isSystem
                        !!lastMessage.is_user,   // isUser
                        null, // messageId (不需要，只是预览)
                        {},   // sanitizerOverrides
                        false // isReasoning
                    );
                    messagePreview = tempDiv.textContent || tempDiv.innerText || lastMessage.mes;
                } catch (e) {
                    console.warn(`[${pluginFolderName}] Error formatting message preview for ${chatFileName}:`, e);
                    messagePreview = lastMessage.mes; // Fallback to raw message
                }
                messagePreview = messagePreview.substring(0, 150) + (messagePreview.length > 150 ? '...' : '');
            }
            const sendDate = lastMessage.send_date ? timestampToMoment(lastMessage.send_date).format('YYYY-MM-DD HH:mm') : '未知时间';

            contentHtml += `
                <li style="border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 5px; margin-bottom: 10px; padding: 10px; background-color: var(--SmartThemeBodyBgDarker, rgba(0,0,0,0.1));">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <strong style="font-size: 1.1em; color: var(--SmartThemeFg);" title="聊天文件名: ${chatFileName}">${chatFileName}</strong>
                        <button class="menu_button open-chat-btn" data-chatfile="${chatFileName}" title="打开此聊天记录" style="font-size: 0.8em; padding: 3px 8px;">打开</button>
                    </div>
                    <div style="font-size: 0.9em; color: var(--SmartThemeFgMuted, #ccc);">
                        <strong style="color: var(--SmartThemeFg);" >${sender}</strong> (${sendDate}):
                    </div>
                    <div style="padding: 5px 0; margin-left: 10px; border-left: 2px solid var(--SmartThemeAccentColor, #555); padding-left: 10px; word-break: break-word; color: var(--SmartThemeFg); white-space: pre-wrap;">
                        ${messagePreview.replace(/</g, "<").replace(/>/g, ">")}
                    </div>
                </li>
            `;
        });
        contentHtml += `</ul>`;
    }
    contentHtml += `</div>`;

    const popup = new Popup(contentHtml, POPUP_TYPE.TEXT, popupTitle, { // title 参数移到第三个位置
        wide: true,
        large: true,
        okButton: true, // "关闭" 按钮
        allowVerticalScrolling: false
    });

    // 事件委托，处理 "打开" 按钮的点击
    // 确保 popup.content 存在后再绑定事件
    if (popup.content) {
        $(popup.content).on('click', '.open-chat-btn', async function() {
            const chatFileToOpen = $(this).data('chatfile');
            if (chatFileToOpen) {
                if (popup.close) popup.close(); // 关闭当前popup
                toastr.info(`正在打开聊天: ${chatFileToOpen}...`);
                try {
                    // 确保当前角色上下文没有变化
                    const currentContext = getContext();
                    if (currentContext.characterId === undefined || currentContext.characters[currentContext.characterId]?.name !== characterName) {
                        toastr.warning('当前角色已更改，请重新操作。');
                        console.warn(`[${pluginFolderName}] Character context changed before opening chat.`);
                        return;
                    }
                    await openCharacterChat(chatFileToOpen);
                } catch (e) {
                    toastr.error(`打开聊天 ${chatFileToOpen} 失败: ${e.message}`);
                    console.error(`[${pluginFolderName}] 打开聊天时出错:`, e);
                }
            }
        });
    } else {
        console.error(`[${pluginFolderName}] Popup content is not available for event binding.`);
    }

    popup.show();
}


/**
 * 主入口函数，在插件加载时执行
 */
jQuery(async () => {
    try {
        console.log(`[${pluginFolderName}] 插件 (client.js - 显示角色末尾消息) 加载中...`);

        // 注入CSS (如果你的插件有 style.css 并且在 manifest.json 中声明了)
        // 如果 manifest.json 中 "css": "style.css" 存在且正确，SillyTavern 会自动加载它。
        // 如果遇到 MIME type 问题，请检查服务器配置或 SillyTavern 如何服务插件静态文件。

        // 加载并注入 "收藏" 按钮 (input_button.html)
        try {
            const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginFolderName}`, 'input_button');
            const buttonContainer = $('#data_bank_wand_container');

            if (buttonContainer.length) {
                buttonContainer.append(inputButtonHtml);
                console.log(`[${pluginFolderName}] "收藏" (末尾消息) 按钮已添加到 #data_bank_wand_container`);

                // 假设 input_button.html 中的按钮ID是 'favorites_button'
                const buttonId = 'favorites_button';
                $(document).on('click', `#${buttonId}`, async () => {
                    console.log(`[${pluginFolderName}] "${buttonId}" 被点击，准备获取角色末尾消息。`);
                    const chatItems = await fetchCharacterLastMessagesFromServer();
                    // chatItems 可能为 null (如果出错或用户未选角色) 或空数组 (如果角色无聊天)
                    if (chatItems !== null) { // 只有在API调用没有直接返回null时才显示popup
                        showLastMessagesPopup(chatItems);
                    }
                });
            } else {
                console.warn(`[${pluginFolderName}] 找不到目标容器 #data_bank_wand_container 来添加按钮。按钮可能不会显示。`);
            }
        } catch (error) {
            console.error(`[${pluginFolderName}] 加载或注入 input_button.html 失败:`, error);
        }

        console.log(`[${pluginFolderName}] 插件 (client.js) 加载完成!`);

    } catch (error) {
        console.error(`[${pluginFolderName}] 插件 (client.js) 初始化过程中出错:`, error);
    }
});
