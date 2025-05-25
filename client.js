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


const pluginFolderName = 'starK'; // 与插件文件夹名称一致
const localServerPort = 3001; // 与本地服务器配置的端口一致
let localServerPingedSuccessfully = false; // Track if local server is responsive

/**
 * Pings the local helper server to check if it's running.
 */
async function pingLocalHelperServer() {
    const pingUrl = `http://127.0.0.1:${localServerPort}/ping-local`;
    try {
        const response = await fetch(pingUrl, { method: 'GET' });
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                console.log(`[${pluginFolderName}] Local helper server ping successful:`, data.message);
                localServerPingedSuccessfully = true;
                return true;
            }
        }
        console.warn(`[${pluginFolderName}] Local helper server ping failed or returned unexpected response. Status: ${response.status}`);
        localServerPingedSuccessfully = false;
        return false;
    } catch (error) {
        console.warn(`[${pluginFolderName}] Cannot connect to local helper server at ${pingUrl}. Is it running? Error:`, error.message);
        localServerPingedSuccessfully = false;
        return false;
    }
}


/**
 * 调用本地辅助服务器 API 获取当前角色所有聊天的最后一条消息
 */
async function fetchCharacterLastMessagesFromLocalServer() {
    const context = getContext();
    if (!context) {
        toastr.error('无法获取SillyTavern上下文。');
        return null;
    }

    if (!localServerPingedSuccessfully) {
        const isServerUp = await pingLocalHelperServer();
        if (!isServerUp) {
            toastr.error(`插件的本地辅助服务器未运行或无响应。请检查SillyTavern服务器控制台的 '${pluginFolderName}' 插件日志。`);
            return null;
        }
    }

    if (context.groupId || context.characterId === undefined) {
        toastr.info('请先选择一个角色。此功能当前仅支持角色。');
        return null;
    }

    const character = context.characters[context.characterId];
    if (!character || !character.avatar) {
        toastr.error('无法获取当前选定角色的信息或头像。');
        return null;
    }

    const apiUrl = `http://127.0.0.1:${localServerPort}/get-character-last-messages`;
    console.log(`[${pluginFolderName}] Fetching last messages from local server: ${apiUrl} for avatar: ${character.avatar}`);

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // 不需要SillyTavern的CSRF Token，因为这是对另一个本地服务的直接调用
            },
            body: JSON.stringify({ character_avatar: character.avatar })
        });

        if (!response.ok) {
            let errorMsg = `本地服务器错误! Status: ${response.status}`;
            let errorDetails = '';
            try {
                errorDetails = await response.text();
                console.error(`[${pluginFolderName}] Local Server API Error Details:`, errorDetails);
                try {
                    const jsonData = JSON.parse(errorDetails);
                    errorMsg = jsonData.error || errorMsg;
                } catch (parseError) {
                    errorMsg += ` - ${errorDetails.substring(0, 100)}`;
                }
            } catch (e) {
                console.error(`[${pluginFolderName}] Error reading error response body from local server:`, e);
            }
            throw new Error(errorMsg);
        }
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || '本地服务器API请求未成功。');
        }
        console.log(`[${pluginFolderName}] Successfully fetched last messages from local server:`, data.chatLastMessages);
        return data.chatLastMessages;
    } catch (error) {
        console.error(`[${pluginFolderName}] 与本地辅助服务器通信时发生错误:`, error);
        toastr.error(`获取角色末尾消息失败: ${error.message}`);
        localServerPingedSuccessfully = false; // Assume server might be down
        return null;
    }
}

/**
 * 显示包含角色所有聊天末尾消息的 Popup
 * @param {Array|null} chatItems - 从后端获取的聊天条目数组
 */
function showLastMessagesPopup(chatItems) {
    const context = getContext();
    if (!context || context.characterId === undefined || !context.characters[context.characterId]) {
        toastr.error('无法获取当前角色信息以显示弹窗。');
        return;
    }
    const characterName = context.characters[context.characterId]?.name || '当前角色';

    let popupTitle = `${characterName} - 末尾消息`;
    let contentHtml = `<div id="character-last-messages-popup">`; // Style applied via CSS
    contentHtml += `<h3>${characterName} - 所有聊天的末尾消息</h3>`;

    if (chatItems === null) { // API call failed or local server issue
        contentHtml += `<p>获取聊天记录失败。请检查浏览器控制台和SillyTavern服务器控制台的日志。</p>`;
    } else if (chatItems.length === 0) {
        contentHtml += `<p>该角色没有聊天记录，或者未能从本地服务器获取到任何聊天的最后一条消息。</p>`;
    } else {
        contentHtml += `<p style="font-size:0.9em; color: var(--SmartThemeFgMuted);">共找到 ${chatItems.length} 个聊天记录。列表按最新消息排序。</p><hr>`;
        contentHtml += `<ul>`;

        chatItems.forEach(item => {
            const { chatFileName, lastMessage } = item;
            const sender = lastMessage.name || (lastMessage.is_user ? (context.name1 || 'User') : (characterName || 'Character'));
            let messagePreview = '(空消息)';
            if (lastMessage.mes) {
                const tempDiv = document.createElement('div');
                try {
                    tempDiv.innerHTML = messageFormatting(
                        lastMessage.mes, sender, !!lastMessage.is_system,
                        !!lastMessage.is_user, null, {}, false
                    );
                    messagePreview = tempDiv.textContent || tempDiv.innerText || lastMessage.mes;
                } catch (e) {
                    messagePreview = lastMessage.mes; // Fallback
                }
                messagePreview = messagePreview.substring(0, 150) + (messagePreview.length > 150 ? '...' : '');
            }
            const sendDate = lastMessage.send_date ? timestampToMoment(lastMessage.send_date).format('YYYY-MM-DD HH:mm') : '未知时间';

            contentHtml += `
                <li>
                    <div class="chat-file-header">
                        <span class="chat-file-name" title="聊天文件名: ${chatFileName}">${chatFileName}</span>
                        <button class="menu_button open-chat-btn" data-chatfile="${chatFileName}" title="打开此聊天记录" style="font-size: 0.8em; padding: 3px 8px;">打开</button>
                    </div>
                    <div class="message-meta">
                        <span class="message-sender">${sender}</span> (${sendDate}):
                    </div>
                    <div class="message-preview-content">
                        ${messagePreview.replace(/</g, "<").replace(/>/g, ">")}
                    </div>
                </li>
            `;
        });
        contentHtml += `</ul>`;
    }
    contentHtml += `</div>`;

    const popup = new Popup(contentHtml, POPUP_TYPE.TEXT, popupTitle, {
        wide: true,
        large: true,
        okButton: true,
        allowVerticalScrolling: true // The main popup itself can scroll if content exceeds max-height
    });

    if (popup.content) {
        $(popup.content).on('click', '.open-chat-btn', async function() {
            const chatFileToOpen = $(this).data('chatfile');
            if (chatFileToOpen) {
                if (popup.close) popup.close();
                toastr.info(`正在打开聊天: ${chatFileToOpen}...`);
                try {
                    const currentContext = getContext(); // Re-check context
                    if (currentContext.characterId === undefined || currentContext.characters[currentContext.characterId]?.name !== characterName) {
                        toastr.warning('当前角色已更改，请重新操作。'); return;
                    }
                    await openCharacterChat(chatFileToOpen);
                } catch (e) {
                    toastr.error(`打开聊天 ${chatFileToOpen} 失败: ${e.message}`);
                }
            }
        });
    }
    popup.show();
}

jQuery(async () => {
    try {
        console.log(`[${pluginFolderName}] 前端脚本 (client.js) 加载中...`);

        // 尝试 Ping 本地服务器以尽早知道它是否可用
        // 不阻塞UI加载，只是预热一下状态
        pingLocalHelperServer().then(isUp => {
            if(isUp) toastr.success(`'${pluginFolderName}' 插件的本地助手已连接!`, '', {timeOut: 2000});
        });


        const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginFolderName}`, 'input_button');
        const buttonContainer = $('#data_bank_wand_container');

        if (buttonContainer.length) {
            buttonContainer.append(inputButtonHtml);
            const buttonId = 'stark_show_last_messages_button'; // 与 input_button.html 中的 ID 一致
            $(document).on('click', `#${buttonId}`, async () => {
                console.log(`[${pluginFolderName}] "${buttonId}" 被点击。`);
                const chatItems = await fetchCharacterLastMessagesFromLocalServer();
                if (chatItems !== null) {
                    showLastMessagesPopup(chatItems);
                }
            });
            console.log(`[${pluginFolderName}] UI按钮 '${buttonId}' 已设置。`);
        } else {
            console.warn(`[${pluginFolderName}] 找不到 #data_bank_wand_container 容器。UI按钮可能不会显示。`);
        }

        console.log(`[${pluginFolderName}] 前端脚本加载完成!`);

    } catch (error) {
        console.error(`[${pluginFolderName}] 前端脚本初始化过程中出错:`, error);
    }
});
