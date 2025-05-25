// public/extensions/third-party/star/index.js
import {
    getContext,
    renderExtensionTemplateAsync,
    // extension_settings, // 可能暂时用不到
    // saveSettingsDebounced, // 可能暂时用不到
} from '../../../extensions.js';

import {
    Popup,
    POPUP_TYPE,
    // callGenericPopup, // 可能暂时用不到
} from '../../../popup.js';

import {
    messageFormatting,    // 用于格式化消息预览
    timestampToMoment,    // 用于格式化日期
    openCharacterChat,    // 用于打开特定聊天
    // characters,        // 从 getContext() 获取
    // getRequestHeaders, // 从 getContext() 获取
} from '../../../../script.js';

const pluginName = 'starK'; // 与文件夹名称一致

// (可以移除所有与当前聊天内收藏相关的函数：ensureFavoritesArrayExists, addFavorite, removeFavoriteById, 等)
// (可以移除所有与预览模式相关的函数：previewState, setupPreviewUI, restoreNormalChatUI, handlePreviewButtonClick 等)

/**
 * 调用后端 API 获取当前角色所有聊天的最后一条消息
 */
async function fetchCharacterLastMessagesFromServer() {
    const context = getContext();
    if (context.groupId || context.characterId === undefined) {
        // SillyTavern中，如果未选择角色，context.characterId 可能是 undefined
        // 如果打开的是群聊，context.groupId 会有值
        toastr.info('请先选择一个角色 (此功能暂不支持群组)。');
        return null;
    }

    const character = context.characters[context.characterId];
    if (!character || !character.avatar) {
        toastr.error('无法获取当前角色信息。');
        return null;
    }

    // 确认插件API的实际挂载路径
    // 通常是 /extensions/third-party/<plugin-folder-name>/<route-in-api.js>
    // 如果 manifest.json 中的插件名是 "star", 且 api.js 中路由是 /get-character-last-messages
    // 则路径可能是 /extensions/third-party/star/get-character-last-messages
    const apiUrl = `/extensions/third-party/${pluginName}/get-character-last-messages`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...context.getRequestHeaders(), // 包含 CSRF Token
            },
            body: JSON.stringify({ character_avatar: character.avatar })
        });

        if (!response.ok) {
            let errorMsg = `HTTP error! Status: ${response.status}`;
            try {
                const errorData = await response.json();
                errorMsg = errorData.error || errorMsg;
            } catch (e) { /* ignore parsing error */ }
            throw new Error(errorMsg);
        }
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'API returned unsuccessful status.');
        }
        return data.chatLastMessages;
    } catch (error) {
        console.error(`[${pluginName}] Error fetching character last messages:`, error);
        toastr.error(`获取角色聊天末尾消息失败: ${error.message}`);
        return null;
    }
}

/**
 * 显示包含角色所有聊天末尾消息的 Popup
 * @param {Array} chatItems - 从后端获取的聊天条目数组
 */
function showLastMessagesPopup(chatItems) {
    const context = getContext();
    const characterName = context.characters[context.characterId]?.name || '当前角色';

    if (!chatItems || chatItems.length === 0) {
        new Popup(
            `<h3>${characterName}</h3><p>该角色没有聊天记录，或者未能获取到任何聊天的最后一条消息。</p>`,
            POPUP_TYPE.TEXT,
            '',
            { title: `角色末尾消息`, wide: true, okButton: true }
        ).show();
        return;
    }

    let contentHtml = `<div id="character-last-messages-popup" style="max-height: 70vh; overflow-y: auto; padding: 10px;">`;
    contentHtml += `<h3>${characterName} - 所有聊天的末尾消息</h3>`;
    contentHtml += `<p style="font-size:0.9em; color: #aaa;">共找到 ${chatItems.length} 个聊天记录。</p><hr>`;
    contentHtml += `<ul style="list-style: none; padding: 0;">`;

    chatItems.forEach(item => {
        const { chatFileName, lastMessage } = item;
        const sender = lastMessage.name || (lastMessage.is_user ? 'User' : 'Character');
        let messagePreview = '(空消息)';
        if (lastMessage.mes) {
            // 简单处理，移除HTML标签做预览，或使用messageFormatting
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = messageFormatting(lastMessage.mes, sender, lastMessage.is_system, lastMessage.is_user, null, {}, false);
            messagePreview = tempDiv.textContent || tempDiv.innerText || lastMessage.mes;
            messagePreview = messagePreview.substring(0, 150) + (messagePreview.length > 150 ? '...' : '');
        }
        const sendDate = lastMessage.send_date ? timestampToMoment(lastMessage.send_date).format('YYYY-MM-DD HH:mm') : '未知时间';

        contentHtml += `
            <li style="border: 1px solid #444; border-radius: 5px; margin-bottom: 10px; padding: 10px; background-color: rgba(0,0,0,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <strong style="font-size: 1.1em;" title="聊天文件名: ${chatFileName}">${chatFileName}</strong>
                    <button class="menu_button open-chat-btn" data-chatfile="${chatFileName}" title="打开此聊天记录" style="font-size: 0.8em; padding: 3px 8px;">打开</button>
                </div>
                <div style="font-size: 0.9em; color: #ccc;">
                    <strong>${sender}</strong> (${sendDate}):
                </div>
                <div style="padding: 5px 0; margin-left: 10px; border-left: 2px solid #555; padding-left: 10px; word-break: break-word;">
                    ${messagePreview}
                </div>
            </li>
        `;
    });

    contentHtml += `</ul></div>`;

    const popup = new Popup(contentHtml, POPUP_TYPE.TEXT, '', {
        title: `${characterName} - 末尾消息`,
        wide: true,
        large: true,
        okButton: true, // "关闭" 按钮
        allowVerticalScrolling: false // Popup本身不滚动，内部div滚动
    });

    // 事件委托，处理 "打开" 按钮的点击
    $(popup.content).on('click', '.open-chat-btn', async function() {
        const chatFileToOpen = $(this).data('chatfile');
        if (chatFileToOpen) {
            popup.close(); // 关闭当前popup
            toastr.info(`正在打开聊天: ${chatFileToOpen}...`);
            try {
                await openCharacterChat(chatFileToOpen); // script.js 中的函数
            } catch (e) {
                toastr.error(`打开聊天 ${chatFileToOpen} 失败: ${e.message}`);
                console.error(`[${pluginName}] Error opening chat:`, e);
            }
        }
    });

    popup.show();
}


/**
 * 主入口函数，在插件加载时执行
 */
jQuery(async () => {
    try {
        console.log(`[${pluginName}] 插件 (简化版 - 显示角色末尾消息) 加载中...`);

        // 注入CSS (如果需要)
        // const styleElement = document.createElement('style');
        // styleElement.innerHTML = ` ... CSS ... `;
        // document.head.appendChild(styleElement);

        // 加载并注入 "收藏" 按钮 (input_button.html)
        try {
            const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'input_button');
            // 确保目标容器存在
            if ($('#data_bank_wand_container').length) {
                $('#data_bank_wand_container').append(inputButtonHtml);
                console.log(`[${pluginName}] "收藏" 按钮已添加到 #data_bank_wand_container`);

                // 为按钮绑定新的点击事件处理器
                // **重要**: input_button.html 中的按钮需要有一个ID，例如 id="star_plugin_button"
                // 假设按钮ID是 'star_plugin_action_button'
                // 如果你的 input_button.html 的按钮 ID 是 favorites_button, 则使用 #favorites_button
                const buttonId = 'favorites_button'; // 与你现有 input_button.html 中的按钮ID保持一致
                $(document).on('click', `#${buttonId}`, async () => {
                    console.log(`[${pluginName}] "${buttonId}" 被点击，准备获取角色末尾消息。`);
                    const chatItems = await fetchCharacterLastMessagesFromServer();
                    if (chatItems) {
                        showLastMessagesPopup(chatItems);
                    }
                });
            } else {
                console.error(`[${pluginName}] 找不到目标容器 #data_bank_wand_container 来添加按钮。`);
            }
        } catch (error) {
            console.error(`[${pluginName}] 加载或注入 input_button.html 失败:`, error);
        }

        // (移除所有原先的事件监听器，如 CHAT_CHANGED, MESSAGE_DELETED 等，因为它们与旧的收藏功能相关)
        // (移除 MutationObserver，因为它与动态添加收藏图标相关)

        console.log(`[${pluginName}] 插件 (简化版) 加载完成!`);

    } catch (error) {
        console.error(`[${pluginName}] 插件初始化过程中出错:`, error);
    }
});
