// ==UserScript==
// @name         CNB Issue 网页内容收藏工具
// @namespace    https://cnb.cool/IIIStudio/Greasemonkey/CNBIssue/
// @version      1.5
// @description  在任意网页上选择页面区域，一键将选中内容从 HTML 转为 Markdown，按"页面信息 + 选择的内容"的格式展示，并可直接通过 CNB 接口创建 Issue。支持链接、图片、代码块/行内代码、标题、列表、表格、引用等常见结构的 Markdown 转换。
// @author       IIIStudio
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.cnb.cool
// @connect      cnb.cool
// @connect      weibo.com
// @connect      *.weibo.com
// @connect      sinaimg.cn
// @connect      *.sinaimg.cn
// @connect      tvax*.sinaimg.cn
// @connect      tva*.sinaimg.cn
// @connect      wx*.sinaimg.cn
// @connect      hb*.sinaimg.cn
// @license MIT
// ==/UserScript==

(function() {
    'use strict';

    // 内存与样式注入防重、窗口/观察者单例
    const __CNB_FLAGS = Object.create(null);
    function addStyleOnce(key, cssText) {
        try {
            if (__CNB_FLAGS[key]) return;
            if (typeof GM_addStyle === 'function') GM_addStyle(cssText);
            __CNB_FLAGS[key] = 1;
        } catch (_) {}
    }
    let __CNB_CLIP_DIALOG = null;
    let __CNB_SETTINGS_DIALOG = null, __CNB_SETTINGS_OVERLAY = null;
    let __CNB_ISSUE_DIALOG = null, __CNB_ISSUE_OVERLAY = null;
    let __CNB_MO = null;
    let __CNB_UNLOAD_BOUND = false;
    let __CNB_DOCK_SHOW_TIMER = null;

    // 配置信息
    const CONFIG = {
        apiBase: 'https://api.cnb.cool',
        repoPath: '',
        accessToken: '',
        issueEndpoint: '/-/issues',
        uploadEnabled: true
    };
    let SAVED_TAGS = [];
    // 选择模式快捷键（可在设置中修改），规范格式如：Shift+E
    let START_HOTKEY = 'Shift+E';
    let HOTKEY_ENABLED = false;

    // 添加自定义样式 - 扁平黑白配色
    GM_addStyle(`
        .cnb-issue-floating-btn {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            background: #000;
            color: #fff;
            border: 2px solid #000;
            border-radius: 0;
            width: 50px;
            height: 50px;
            cursor: pointer;
            box-shadow: none;
            font-size: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s ease;
        }
        .cnb-issue-floating-btn:hover {
            background: #fff;
            color: #000;
            transform: none;
        }
        .cnb-issue-dialog {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #fff;
            border: 2px solid #000;
            border-radius: 0;
            padding: 16px;
            z-index: 10001;
            box-shadow: 4px 4px 0 #000;
            min-width: 500px;
            max-width: 90vw;
            max-height: 80vh;
            overflow: auto;
        }
        .cnb-issue-dialog h3 {
            margin: 0 0 12px 0;
            color: #000;
            font-size: 16px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .cnb-issue-dialog textarea {
            width: 100%;
            height: 300px;
            margin: 8px 0;
            padding: 10px;
            border: 2px solid #000;
            border-radius: 0;
            resize: vertical;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 12px;
            line-height: 1.4;
            background: #fff;
            color: #000;
            box-shadow: none;
        }
        .cnb-issue-dialog textarea:focus {
            outline: none;
            border-color: #000;
        }
        .cnb-issue-dialog input {
            width: 100%;
            margin: 8px 0;
            padding: 8px 10px;
            border: 2px solid #000;
            border-radius: 0;
            background: #fff;
            color: #000;
            box-shadow: none;
        }
        .cnb-issue-dialog input:focus {
            outline: none;
            border-color: #000;
        }
        .cnb-issue-dialog-buttons {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 12px;
        }
        /* 仅底部操作按钮生效，避免影响设置区的小按钮与"×" */
        .cnb-issue-dialog .cnb-issue-dialog-buttons > button {
            padding: 8px 16px;
            border: 2px solid #000;
            border-radius: 0;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.1s ease;
            background: #fff;
            color: #000;
            box-shadow: 2px 2px 0 #000;
        }
        .cnb-issue-dialog .cnb-issue-dialog-buttons > button:active {
            transform: translate(2px, 2px);
            box-shadow: none;
        }
        .cnb-issue-btn-confirm {
            background: #000;
            color: #fff;
        }
        .cnb-issue-btn-cancel {
            background: #fff;
            color: #000;
        }
        .cnb-issue-btn-confirm:hover {
            background: #333;
            border-color: #000;
        }
        .cnb-issue-btn-cancel:hover {
            background: #f0f0f0;
            border-color: #000;
        }
        /* 创建完成Issue 按钮样式 */
        .cnb-issue-btn-done {
            background: #000;
            color: #fff;
        }
        .cnb-issue-btn-done:hover {
            background: #333;
        }
        .cnb-issue-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.7);
            z-index: 10000;
        }
        .cnb-issue-loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #e0e0e0;
            border-top: 3px solid #000;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 10px;
        }

        /* 区域选择模式样式 */
        .cnb-selection-mode * {
            cursor: crosshair !important;
        }
        .cnb-selection-hover {
            outline: 3px solid #000 !important;
            background-color: rgba(0, 0, 0, 0.08) !important;
        }
        .cnb-selection-selected {
            outline: 4px solid #000 !important;
            background-color: rgba(0, 0, 0, 0.12) !important;
        }
        .cnb-selection-tooltip {
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: #000;
            color: #fff;
            padding: 5px 20px;
            border-radius: 0;
            border: 2px solid #000;
            z-index: 10002;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 3px 3px 0 rgba(0,0,0,0.5);
        }
        .cnb-selection-tooltip button {
            margin-left: 10px;
            padding: 1px 12px;
            background: #fff;
            color: #000;
            border: 2px solid #fff;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.1s ease;
        }
        .cnb-selection-tooltip button:hover {
            background: #000;
            color: #fff;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `);

    /* 左侧贴边 Dock 控制栏（自动隐藏，鼠标移到左边缘显示） - 扁平黑白配色 */
    GM_addStyle(`
        .cnb-dock {
            position: fixed;
            left: -200px;
            top: 40%;
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 6px 6px 6px 10px;
            background: #fff;
            border: 2px solid #000;
            border-left: none;
            border-radius: 0 0 0 0;
            box-shadow: 3px 3px 0 #000;
            z-index: 10002;
            transition: left .15s ease, opacity .15s ease;
            opacity: 0.9;
        }
        .cnb-dock:hover,
        .cnb-dock.cnb-dock--visible {
            left: 0;
            opacity: 1;
        }
        .cnb-dock .cnb-dock-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 64px;
            height: 32px;
            padding: 0 10px;
            font-size: 12px;
            font-weight: 600;
            color: #000;
            background: #fff;
            border: 2px solid #000;
            border-radius: 0;
            cursor: pointer;
            transition: all 0.1s ease;
        }
        .cnb-dock .cnb-dock-btn:hover {
            background: #000;
            color: #fff;
        }
        .cnb-dock .cnb-dock-btn:active {
            transform: translate(1px, 1px);
        }
        .cnb-dock-trigger {
            position: fixed;
            left: 0;
            top: 40%;
            width: 20px;
            height: 150px;
            z-index: 10001;
        }
    `);

    // 追加设置按钮样式 - 扁平黑白配色
    GM_addStyle(`
        .cnb-issue-settings-btn {
            position: fixed;
            z-index: 10000;
            background: #000;
            color: #fff;
            border: 2px solid #000;
            border-radius: 0;
            width: 44px;
            height: 44px;
            cursor: pointer;
            box-shadow: 2px 2px 0 rgba(0,0,0,0.5);
            font-size: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.1s ease;
        }
        .cnb-issue-settings-btn:hover {
            background: #fff;
            color: #000;
        }
    `);

    /* 强制隔离并统一控件样式，避免继承站点样式 - 扁平黑白配色 */
    GM_addStyle(`
        .cnb-issue-dialog input.cnb-control,
        .cnb-issue-dialog textarea.cnb-control {
            box-sizing: border-box !important;
            width: 100% !important;
            margin: 8px 0 !important;
            padding: 10px 12px !important;
            border: 2px solid #000 !important;
            border-radius: 0 !important;
            background: #fff !important;
            color: #000 !important;
            font: normal 14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Helvetica,Arial,"PingFang SC","Microsoft Yahei",sans-serif !important;
            outline: none !important;
            appearance: none !important;
            -webkit-appearance: none !important;
            -moz-appearance: none !important;
            transition: all 0.1s ease !important;
            height: 36px !important;
        }
        .cnb-issue-dialog textarea.cnb-control {
            min-height: 300px !important;
            resize: vertical !important;
            font-family: 'Monaco','Menlo','Ubuntu Mono',monospace !important;
            font-size: 12px !important;
            line-height: 1.4 !important;
        }
        .cnb-issue-dialog input.cnb-control:focus,
        .cnb-issue-dialog textarea.cnb-control:focus {
            border-color: #000 !important;
        }
        /* 仅底部操作按钮生效，避免影响设置区的小按钮与"×" */
        .cnb-issue-dialog .cnb-issue-dialog-buttons > button {
            padding: 5px 15x !important;
            border: 2px solid #000 !important;
            border-radius: 0 !important;
            cursor: pointer !important;
            font-size: 14px !important;
            font-weight: 600 !important;
            transition: all 0.1s ease !important;
            background: #fff !important;
            color: #000 !important;
            box-shadow: 2px 2px 0 #000 !important;
        }
        .cnb-issue-dialog .cnb-issue-dialog-buttons > button:active {
            transform: translate(2px, 2px) !important;
            box-shadow: none !important;
        }
        .cnb-issue-btn-confirm { background: #000 !important; color: #fff !important; }
        .cnb-issue-btn-confirm:hover { background: #333 !important; color: #fff !important; }
        .cnb-issue-btn-cancel { background: #fff !important; color: #000 !important; }
        .cnb-issue-btn-cancel:hover { background: #f0f0f0 !important; color: #000 !important; }
        /* 新增：创建完成Issue 按钮（黑色） */
        .cnb-issue-btn-done { background: #000 !important; color: #fff !important; }
        .cnb-issue-btn-done:hover { background: #333 !important; color: #fff !important; }

        /* 标签选择按钮 - 扁平黑白配色 */
        #cnb-issue-tags { margin-top: 6px !important; }
        .cnb-tag-btn {
            margin: 4px !important;
            padding: 1px 8px !important;
            border: 2px solid #000 !important;
            border-radius: 0 !important;
            background: #fff !important;
            color: #000 !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            cursor: pointer !important;
            transition: all 0.1s ease !important;
        }
        .cnb-tag-btn:hover {
            background: #000 !important;
            color: #fff !important;
        }
        .cnb-tag-btn.active {
            background: #000 !important;
            border-color: #000 !important;
            color: #fff !important;
        }

        /* 设置页：标签胶囊与删除按钮 - 扁平黑白配色 */
        .cnb-tags-list { margin-top: 8px !important; }
        .cnb-tag-pill {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            margin: 4px !important;
            padding: 1px 8px !important;
            border: 2px solid #000 !important;
            border-radius: 0 !important;
            background: #fff !important;
            color: #000 !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            line-height: 1.2 !important;
            white-space: nowrap !important;
            vertical-align: middle !important;
            box-shadow: none !important;
            transition: all 0.1s ease !important;
            user-select: none !important;
        }
        .cnb-tag-pill:hover {
            background: #000 !important;
            color: #fff !important;
        }
        .cnb-tag-delbtn {
            margin-left: 4px !important;
            border: none !important;
            background: transparent !important;
            cursor: pointer !important;
            color: #000 !important;
            font-size: 18px !important;
            font-weight: 700 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            height: 20px !important;
            padding: 0 4px !important;
            line-height: 20px !important;
            border-radius: 0 !important;
            box-sizing: border-box !important;
            white-space: nowrap !important;
            min-width: 0 !important;
        }
        .cnb-tag-pill:hover .cnb-tag-delbtn {
            color: #fff !important;
        }

        /* 设置页：输入与按钮排列 - 扁平黑白配色 */
        .cnb-flex {
            display: flex !important;
            gap: 8px !important;
            align-items: center !important;
            flex-wrap: nowrap !important;
        }
        .cnb-tag-addbtn, .cnb-tag-fetchbtn {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            white-space: nowrap !important;
            height: 36px !important;
            padding: 0 16px !important;
            box-sizing: border-box !important;
            border-radius: 0 !important;
            border: 2px solid #000 !important;
            background: #000 !important;
            color: #fff !important;
            cursor: pointer !important;
            font-size: 14px !important;
            font-weight: 600 !important;
            flex: 0 0 auto !important;
            min-width: max-content !important;
            transition: all 0.1s ease !important;
        }
        .cnb-tag-addbtn:hover, .cnb-tag-fetchbtn:hover {
            background: #fff !important;
            color: #000 !important;
        }
        .cnb-tag-fetchbtn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        /* 让输入框可伸缩并等高 */
        .cnb-flex .cnb-control#cnb-setting-newtag {
            height: 36px !important;
            flex: 1 1 auto !important;
        }

        /* 提示文本 */
        .cnb-hint {
            color: #666 !important;
            font-size: 12px !important;
        }

        /* 图片上传开关容器 */
        .cnb-image-upload-toggle {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
            margin-top: 5px !important;
        }

        /* 开关样式 - 扁平黑白配色 */
        .cnb-toggle-switch {
            position: relative !important;
            display: inline-block !important;
            width: 48px !important;
            height: 26px !important;
        }

        .cnb-toggle-switch input {
            opacity: 0 !important;
            width: 0 !important;
            height: 0 !important;
        }

        .cnb-toggle-slider {
            position: absolute !important;
            cursor: pointer !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            background-color: #e0e0e0 !important;
            transition: .15s !important;
            border-radius: 0 !important;
            border: 2px solid #000 !important;
        }

        .cnb-toggle-slider:before {
            position: absolute !important;
            content: "" !important;
            height: 16px !important;
            width: 16px !important;
            left: 4px !important;
            bottom: 4px !important;
            background-color: #000 !important;
            transition: .15s !important;
            border-radius: 0 !important;
        }

        .cnb-toggle-switch input:checked + .cnb-toggle-slider {
            background-color: #000 !important;
        }

        .cnb-toggle-switch input:checked + .cnb-toggle-slider:before {
            transform: translateX(22px) !important;
            background-color: #fff !important;
        }

        /* Issue号输入框样式 - 覆盖全局的 width: 100% */
        .cnb-issue-dialog input.cnb-issue-number-input {
            width: 90px !important;
            margin-left: 8px !important;
        }

        /* 开关样式（无文字，仅图形） - 扁平黑白配色 */
        .cnb-switch {
            position: relative !important;
            display: inline-block !important;
            width: 44px !important;
            height: 24px !important;
            vertical-align: middle !important;
        }
        .cnb-switch input {
            opacity: 0 !important;
            width: 0 !important;
            height: 0 !important;
            position: absolute !important;
        }
        .cnb-switch-slider {
            position: absolute !important;
            inset: 0 !important;
            background: #e0e0e0 !important;
            border-radius: 0 !important;
            border: 2px solid #000 !important;
            transition: background-color .15s ease !important;
            box-shadow: none !important;
            cursor: pointer !important;
        }
        .cnb-switch-slider::before {
            content: '' !important;
            position: absolute !important;
            left: 4px !important;
            top: 4px !important;
            width: 14px !important;
            height: 14px !important;
            background: #000 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            transition: transform .15s ease !important;
        }
        .cnb-switch input:checked + .cnb-switch-slider {
            background: #000 !important;
        }
        .cnb-switch input:checked + .cnb-switch-slider::before {
            transform: translateX(20px) !important;
            background: #fff !important;
        }

        /* 统一滚动条样式 - 扁平黑白配色 */
        .cnb-issue-dialog, .cnb-issue-list, .cnb-clipwin, .cnb-clipwin-content, .cnb-clipwin-body {
            scrollbar-width: thin;
            scrollbar-color: #000 #f5f5f5;
        }
        .cnb-issue-dialog::-webkit-scrollbar,
        .cnb-issue-list::-webkit-scrollbar,
        .cnb-clipwin::-webkit-scrollbar,
        .cnb-clipwin-content::-webkit-scrollbar,
        .cnb-clipwin-body::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        .cnb-issue-dialog::-webkit-scrollbar-track,
        .cnb-issue-list::-webkit-scrollbar-track,
        .cnb-clipwin::-webkit-scrollbar-track,
        .cnb-clipwin-content::-webkit-scrollbar-track,
        .cnb-clipwin-body::-webkit-scrollbar-track {
            background: #f5f5f5;
        }
        .cnb-issue-dialog::-webkit-scrollbar-thumb,
        .cnb-issue-list::-webkit-scrollbar-thumb,
        .cnb-clipwin::-webkit-scrollbar-thumb,
        .cnb-clipwin-content::-webkit-scrollbar-thumb,
        .cnb-clipwin-body::-webkit-scrollbar-thumb {
            background: #000;
            border-radius: 0;
        }
        .cnb-issue-dialog::-webkit-scrollbar-thumb:hover,
        .cnb-issue-list::-webkit-scrollbar-thumb:hover,
        .cnb-clipwin::-webkit-scrollbar-thumb:hover,
        .cnb-clipwin-content::-webkit-scrollbar-thumb:hover,
        .cnb-clipwin-body::-webkit-scrollbar-thumb:hover {
            background: #333;
        }
    `);

    let isSelecting = false;
    let selectedElement = null;
    // 多选集合与最近一次选择的元素
    let selectedElements = new Set();
    let lastSelectedElement = null;

    // HTML转Markdown的转换器
    const htmlToMarkdown = {
        // 图片收集列表
        images: [],

        // 转换入口函数
        convert: function(html) {
            // 重置图片列表
            this.images = [];
            // 创建临时容器
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;

            // 清理不需要的元素
            this.cleanUnwantedElements(tempDiv);

            // 递归转换
            return this.processNode(tempDiv).trim();
        },

        // 清理不需要的元素
        cleanUnwantedElements: function(element) {
            const unwantedSelectors = [
                'script', 'style', 'noscript', 'link', 'meta',
                // 广告相关（更安全的选择器，避免误伤 heading/markdown/header 等）
                '.ads', '.advertisement', '[class*="advert"]', '[id*="advert"]', '[id^="ad-"]', '[id^="ads-"]',
                // 隐藏元素
                '.hidden', '[style*="display:none"]', '[style*="display: none"]'
            ];

            unwantedSelectors.forEach(selector => {
                const elements = element.querySelectorAll(selector);
                elements.forEach(el => el.remove());
            });
        },

        // 处理节点
        processNode: function(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                return this.escapeText(node.textContent || '');
            }

            if (node.nodeType !== Node.ELEMENT_NODE) {
                return '';
            }

            const tagName = node.tagName.toLowerCase();
            const children = Array.from(node.childNodes);
            const childrenContent = children.map(child => this.processNode(child)).join('');

            switch (tagName) {
                case 'h1':
                    return `# ${childrenContent}\n\n`;
                case 'h2':
                    return `## ${childrenContent}\n\n`;
                case 'h3':
                    return `### ${childrenContent}\n\n`;
                case 'h4':
                    return `#### ${childrenContent}\n\n`;
                case 'h5':
                    return `##### ${childrenContent}\n\n`;
                case 'h6':
                    return `###### ${childrenContent}\n\n`;
                case 'p':
                    return `${childrenContent}\n\n`;
                case 'br':
                    return '\n';
                case 'hr':
                    return '---\n\n';
                case 'strong':
                case 'b':
                    return `**${childrenContent}**`;
                case 'em':
                case 'i':
                    return `*${childrenContent}*`;
                case 'code':
                    if (node.parentElement.tagName.toLowerCase() === 'pre') {
                        return childrenContent;
                    }
                    return `\`${childrenContent}\``;
                case 'pre':
                    const language = node.querySelector('code')?.className?.replace('language-', '') || '';
                    const raw = node.textContent || '';
                    return `\`\`\`${language}\n${raw}\n\`\`\`\n\n`;
                case 'a':
                    const href = node.getAttribute('href') || '';
                    // 提取可见文本（去掉空白）
                    const visibleText = (childrenContent || '').replace(/\s+/g, '');
                    // 规则：
                    // 1) 如果 href 为空：仅返回子内容（可能有内嵌 strong/img 等）
                    // 2) 如果 href 以 '#' 开头且无可见文本（通常是锚点图标/空链接）：丢弃该链接，仅返回子内容，避免生成 [](#...)
                    // 3) 其他情况：按 [text](href) 输出。
                    if (!href) {
                        return childrenContent;
                    }
                    if (href.startsWith('#') && visibleText.length === 0) {
                        return '';
                    }
                    return `[${childrenContent}](${href})`;
                case 'img':
                    const src = node.getAttribute('src') || '';
                    const alt = node.getAttribute('alt') || '';
                    // 收集图片信息用于上传
                    if (src && !src.startsWith('data:')) {
                        this.images.push({
                            src: src,
                            alt: alt,
                            element: node
                        });
                    }
                    return `![${alt}](${src})`;
                case 'ul':
                    return `${childrenContent}\n`;
                case 'ol':
                    return `${childrenContent}\n`;
                case 'li':
                    const parentTag = node.parentElement.tagName.toLowerCase();
                    if (parentTag === 'ol') {
                        const index = Array.from(node.parentElement.children).indexOf(node) + 1;
                        return `${index}. ${childrenContent}\n`;
                    } else {
                        return `- ${childrenContent}\n`;
                    }
                case 'blockquote':
                    return `> ${childrenContent.split('\n').join('\n> ')}\n\n`;
                case 'table':
                    const rows = node.querySelectorAll('tr');
                    let tableContent = '';

                    // 表头
                    const headerCells = rows[0]?.querySelectorAll('th, td') || [];
                    if (headerCells.length > 0) {
                        tableContent += '| ' + Array.from(headerCells).map(cell => this.processNode(cell).replace(/\n/g, ' ').trim()).join(' | ') + ' |\n';
                        tableContent += '| ' + Array.from(headerCells).map(() => '---').join(' | ') + ' |\n';
                    }

                    // 数据行
                    for (let i = 1; i < rows.length; i++) {
                        const cells = rows[i].querySelectorAll('td');
                        if (cells.length > 0) {
                            tableContent += '| ' + Array.from(cells).map(cell => this.processNode(cell).replace(/\n/g, ' ').trim()).join(' | ') + ' |\n';
                        }
                    }

                    return tableContent + '\n';
                case 'div':
                case 'section':
                case 'article':
                case 'main':
                case 'header':
                case 'footer':
                case 'nav':
                case 'aside':
                    // 当容器中含有标题元素时，确保子内容以换行分隔，避免标题不在行首而无法识别
                    try {
                        const hasHeading = typeof node.querySelector === 'function' && node.querySelector('h1, h2, h3, h4, h5, h6');
                        if (hasHeading) {
                            const joined = children.map(child => this.processNode(child)).join('\n');
                            return `\n${joined}\n`;
                        }
                    } catch (_) {}
                    return `${childrenContent}\n`;
                default:
                    return childrenContent;
            }
        },

        // 转义文本
        escapeText: function(text) {
            return text
                .replace(/\*/g, '\\*')
                .replace(/_/g, '\\_')
                .replace(/`/g, '\\`')
                .replace(/\[/g, '\\[')
                .replace(/\]/g, '\\]')
                .replace(/\(/g, '\\(')
                .replace(/\)/g, '\\)')
                .replace(/#/g, '\\#')
                .replace(/\+/g, '\\+')
                .replace(/!/g, '\\!')
                .replace(/\|/g, '\\|')
                .replace(/\n\s*\n/g, '\n\n')
                .replace(/[ \t]+/g, ' ')
                .trim();
        }
    };

    // 热键工具：规范化与匹配
    function normalizeHotkeyString(s) {
        if (!s) return '';
        return s.split('+').map(p => p.trim()).filter(Boolean).map(p => {
            const up = p.toLowerCase();
            if (up === 'ctrl') return 'Control';
            if (up === 'control') return 'Control';
            if (up === 'meta' || up === 'cmd' || up === 'command') return 'Meta';
            if (up === 'alt' || up === 'option') return 'Alt';
            if (up === 'shift') return 'Shift';
            if (up.length === 1) return up.toUpperCase();
            // 常见功能键统一首字母大写
            return p[0].toUpperCase() + p.slice(1);
        }).join('+');
    }
    function toDisplayHotkeyString(s) {
        if (!s) return '';
        return s.replace(/\bControl\b/g, 'Ctrl');
    }
    function eventToHotkeyString(e) {
        const parts = [];
        if (e.ctrlKey) parts.push('Control');
        if (e.shiftKey) parts.push('Shift');
        if (e.altKey) parts.push('Alt');
        if (e.metaKey) parts.push('Meta');
        let key = e.key;
        if (!key) return parts.join('+');
        // 忽略纯修饰键
        if (['Control','Shift','Alt','Meta'].includes(key)) key = '';
        // 统一字母为大写，功能键保持名称
        if (key && key.length === 1) key = key.toUpperCase();
        if (key === ' ') key = 'Space';
        if (key === 'Esc') key = 'Escape';
        if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
            // 保持不变
        }
        return parts.concat(key ? [key] : []).join('+');
    }
    function matchesHotkey(e, hotkeyStr) {
        const want = normalizeHotkeyString(hotkeyStr);
        const got = eventToHotkeyString(e);
        return want && got === want;
    }
    function isEditableTarget(el) {
        if (!el) return false;
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
        if (el.isContentEditable) return true;
        return false;
    }
    function globalHotkeyHandler(e) {
        // 避免在输入编辑时触发；对话框/遮罩存在时也不触发
        if (!HOTKEY_ENABLED) return;
        if (isEditableTarget(e.target)) return;
        if (document.querySelector('.cnb-issue-dialog') || document.querySelector('.cnb-issue-overlay')) return;
        if (!isSelecting && matchesHotkey(e, START_HOTKEY)) {
            e.preventDefault();
            startAreaSelection();
        }
    }

    // 创建左侧 Dock（去除拖动，仅点击）
    function createFloatingButton() {
        const dock = document.createElement('div');
        dock.className = 'cnb-dock';

        const btnSelect = document.createElement('button');
        btnSelect.className = 'cnb-dock-btn';
        btnSelect.textContent = '选择';
        btnSelect.addEventListener('click', (e) => {
            e.preventDefault();
            startAreaSelection();
        });

        const btnSettings = document.createElement('button');
        btnSettings.className = 'cnb-dock-btn';
        btnSettings.textContent = '设置';
        btnSettings.addEventListener('click', (e) => {
            e.preventDefault();
            openSettingsDialog();
        });

        dock.appendChild(btnSelect);
        dock.appendChild(btnSettings);
        const btnList = document.createElement('button');
        btnList.className = 'cnb-dock-btn';
        btnList.textContent = '列表';
        btnList.addEventListener('click', (e) => {
            e.preventDefault();
            openIssueList();
        });
        dock.appendChild(btnList);

        // 剪贴板（根据设置的"剪贴板位置"是否为空来决定是否显示）
        let __cnbClipCfg = '';
        try { if (typeof GM_getValue === 'function') { const v = GM_getValue('cnbClipboardIssue', ''); __cnbClipCfg = String(v || '').trim(); } } catch (_) {}
        if (__cnbClipCfg) {
            const btnClipboard = document.createElement('button');
            btnClipboard.id = 'cnb-btn-clipboard';
            btnClipboard.className = 'cnb-dock-btn';
            btnClipboard.textContent = '剪贴板';
            btnClipboard.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof openClipboardWindow === 'function') {
                    openClipboardWindow();
                }
            });
            dock.appendChild(btnClipboard);
        }

        document.body.appendChild(dock);

        // 创建左边缘触发区域
        const trigger = document.createElement('div');
        trigger.className = 'cnb-dock-trigger';
        document.body.appendChild(trigger);

        // 等待dock完全渲染后，设置触发区域的尺寸
        setTimeout(() => {
            const dockRect = dock.getBoundingClientRect();
            trigger.style.top = dockRect.top + 'px';
            trigger.style.height = dockRect.height + 'px';
        }, 0);

        // 鼠标移到触发区域时显示dock（延迟显示，避免过于敏感）
        trigger.addEventListener('mouseenter', () => {
            // 清除之前的定时器
            if (__CNB_DOCK_SHOW_TIMER) {
                clearTimeout(__CNB_DOCK_SHOW_TIMER);
            }
            // 延迟300ms后显示
            __CNB_DOCK_SHOW_TIMER = setTimeout(() => {
                dock.classList.add('cnb-dock--visible');
            }, 300);
        });

        // 鼠标离开触发区域时取消显示
        trigger.addEventListener('mouseleave', () => {
            if (__CNB_DOCK_SHOW_TIMER) {
                clearTimeout(__CNB_DOCK_SHOW_TIMER);
                __CNB_DOCK_SHOW_TIMER = null;
            }
        });

        // 鼠标进入dock时立即显示（并取消延迟）
        dock.addEventListener('mouseenter', () => {
            if (__CNB_DOCK_SHOW_TIMER) {
                clearTimeout(__CNB_DOCK_SHOW_TIMER);
                __CNB_DOCK_SHOW_TIMER = null;
            }
            dock.classList.add('cnb-dock--visible');
        });

        // 鼠标离开dock时隐藏
        dock.addEventListener('mouseleave', () => {
            dock.classList.remove('cnb-dock--visible');
        });

        // 点击页面其他地方时隐藏dock
        const handleClickOutside = (e) => {
            // 如果点击的不是 dock 内部，也不是触发区域，则隐藏
            if (!dock.contains(e.target) && !trigger.contains(e.target)) {
                dock.classList.remove('cnb-dock--visible');
            }
        };

        // 使用捕获阶段监听，确保能捕获所有点击
        document.addEventListener('click', handleClickOutside, true);

        // 将点击事件监听器绑定到 dock 元素上，以便后续可以移除
        dock._clickOutsideHandler = handleClickOutside;

        return dock;
    }

    // 开始区域选择模式
    function startAreaSelection() {
        if (isSelecting) return;

        isSelecting = true;
        document.body.classList.add('cnb-selection-mode');

        // 创建提示工具条
        const tooltip = document.createElement('div');
        tooltip.className = 'cnb-selection-tooltip';
        tooltip.innerHTML = `
            请点击选择页面区域 (将转换为Markdown格式)
            <button id="cnb-confirm-selection">确认选择</button>
            <button id="cnb-cancel-selection">取消</button>
        `;
        tooltip.id = 'cnb-selection-tooltip';
        document.body.appendChild(tooltip);

        // 添加事件监听
        const confirmBtn = tooltip.querySelector('#cnb-confirm-selection');
        const cancelBtn = tooltip.querySelector('#cnb-cancel-selection');

        confirmBtn.addEventListener('click', () => {
            if (selectedElements && selectedElements.size > 0) {
                showIssueDialog(Array.from(selectedElements));
            } else {
                GM_notification({
                    text: '请先选择区域（支持 Ctrl+点击多选）',
                    title: 'CNB Issue工具',
                    timeout: 3000
                });
            }
        });

        cancelBtn.addEventListener('click', stopAreaSelection);

        // 添加鼠标移动和点击事件
        document.addEventListener('mouseover', handleMouseOver);
        document.addEventListener('mouseout', handleMouseOut);
        document.addEventListener('click', handleElementClick);

        // ESC键取消选择
        document.addEventListener('keydown', handleKeyDown);
    }

    // 停止区域选择模式
    function stopAreaSelection() {
        isSelecting = false;
        document.body.classList.remove('cnb-selection-mode');

        // 移除提示工具条
        const tooltip = document.getElementById('cnb-selection-tooltip');
        if (tooltip) {
            document.body.removeChild(tooltip);
        }

        // 移除样式（包含已选与悬停高亮）
        if (selectedElement) {
            selectedElement.classList.remove('cnb-selection-selected');
        }
        const toClear = document.querySelectorAll('.cnb-selection-hover, .cnb-selection-selected');
        toClear.forEach(el => {
            el.classList.remove('cnb-selection-hover');
            el.classList.remove('cnb-selection-selected');
        });
        selectedElements = new Set();
        lastSelectedElement = null;
        selectedElement = null;

        // 移除事件监听
        document.removeEventListener('mouseover', handleMouseOver);
        document.removeEventListener('mouseout', handleMouseOut);
        document.removeEventListener('click', handleElementClick);
        document.removeEventListener('keydown', handleKeyDown);
    }

    // 处理鼠标悬停
    function handleMouseOver(e) {
        if (!isSelecting) return;

        const element = e.target;
        if (!selectedElements.has(element) && !element.closest('.cnb-dock')) {
            // 移除之前的高亮
            const previousHighlight = document.querySelector('.cnb-selection-hover');
            if (previousHighlight) {
                previousHighlight.classList.remove('cnb-selection-hover');
            }

            // 高亮当前元素
            element.classList.add('cnb-selection-hover');
        }
    }

    // 处理鼠标移出
    function handleMouseOut(e) {
        if (!isSelecting) return;

        const element = e.target;
        if (!selectedElements.has(element) && element.classList.contains('cnb-selection-hover')) {
            element.classList.remove('cnb-selection-hover');
        }
    }

    // 处理元素点击
    function handleElementClick(e) {
        if (!isSelecting) return;

        e.preventDefault();
        e.stopPropagation();

        const element = e.target;

        // Ctrl 多选：切换该元素选中状态；否则保持单选
        if (e.ctrlKey === true) {
            element.classList.remove('cnb-selection-hover');
            if (selectedElements.has(element)) {
                element.classList.remove('cnb-selection-selected');
                selectedElements.delete(element);
            } else {
                element.classList.add('cnb-selection-selected');
                selectedElements.add(element);
                lastSelectedElement = element;
            }
        } else {
            selectedElements.forEach(el => el.classList.remove('cnb-selection-selected'));
            selectedElements.clear();
            selectedElement = element;
            selectedElement.classList.remove('cnb-selection-hover');
            selectedElement.classList.add('cnb-selection-selected');
            selectedElements.add(selectedElement);
            lastSelectedElement = selectedElement;
        }

        // 更新提示信息
        const tooltip = document.getElementById('cnb-selection-tooltip');
        if (tooltip) {
            const tagName = element.tagName.toLowerCase();
            const className = element.className ? ` class="${element.className.split(' ')[0]}"` : '';
            tooltip.innerHTML = `
                已选择: &lt;${tagName}${className}&gt; (将转换为Markdown)
                <button id="cnb-confirm-selection">确认选择</button>
                <button id="cnb-cancel-selection">取消</button>
            `;

            // 重新绑定事件
            const confirmBtn = tooltip.querySelector('#cnb-confirm-selection');
            const cancelBtn = tooltip.querySelector('#cnb-cancel-selection');

            confirmBtn.addEventListener('click', () => {
                if (selectedElements && selectedElements.size > 0) {
                    showIssueDialog(Array.from(selectedElements));
                } else if (typeof GM_notification === 'function') {
                    GM_notification({
                        text: '请先选择区域（支持 Ctrl+点击多选）',
                        title: 'CNB Issue工具',
                        timeout: 3000
                    });
                }
            });

            cancelBtn.addEventListener('click', stopAreaSelection);
        }
    }

    // 处理按键
    function handleKeyDown(e) {
        if (e.key === 'Escape') {
            stopAreaSelection();
        } else if (e.key === 'Enter' || e.key === 'NumpadEnter') {
            if (isSelecting && selectedElements && selectedElements.size > 0) {
                e.preventDefault();
                showIssueDialog(Array.from(selectedElements));
            }
        }
    }

    // 显示创建Issue的对话框
    function showIssueDialog(selected) {
        stopAreaSelection(); // 先退出选择模式

        // 获取选择的内容并转换为Markdown（支持多选）
        const elements = Array.isArray(selected) ? selected : (selected ? [selected] : []);
        const pageTitle = document.title;
        const pageUrl = window.location.href;

        // 检测是否为微博网站
        const isWeibo = location.hostname === 'weibo.com' || location.hostname.endsWith('.weibo.com');

        // 微博特殊处理：截图模式
        if (isWeibo && elements.length > 0) {
            handleWeiboSelection(elements, pageUrl, pageTitle);
            return;
        }

        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'cnb-issue-overlay';

        // 创建对话框
        const dialog = document.createElement('div');
        dialog.className = 'cnb-issue-dialog';

        // 强化筛选标签按钮样式（避免被站点样式覆盖，统一为胶囊风格）
        GM_addStyle(`
            .cnb-issue-dialog .cnb-issue-filter { display:flex !important; flex-wrap:wrap !important; gap:5px !important; }
            .cnb-issue-dialog .cnb-issue-filter .cnb-issue-filter-btn {
                display: inline-flex !important;
                align-items: center !important;
                gap: 6px !important;
                padding: 4px 10px !important;
                border: 1px solid #d0d7de !important;
                border-radius: 9999px !important;
                background: #fff !important;
                color: #24292f !important;
                font-size: 13px !important;
                line-height: 1.2 !important;
                white-space: nowrap !important;
                vertical-align: middle !important;
                box-shadow: 0 1px 0 rgba(27,31,36,0.04) !important;
                transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, transform .02s ease !important;
                cursor: pointer !important;
                user-select: none !important;
            }
            .cnb-issue-dialog .cnb-issue-filter .cnb-issue-filter-btn:hover {
                background: #f6f8fa !important;
                border-color: #afb8c1 !important;
                box-shadow: 0 1px 0 rgba(27,31,36,0.06) !important;
            }
            .cnb-issue-dialog .cnb-issue-filter .cnb-issue-filter-btn.active {
                background: #0366d6 !important;
                border-color: #0256b9 !important;
                color: #fff !important;
                box-shadow: 0 1px 0 rgba(27,31,36,0.05) !important;
            }
            .cnb-issue-dialog .cnb-issue-filter .cnb-issue-filter-btn.pressed {
                transform: translateY(1px) scale(0.98) !important;
                box-shadow: 0 1px 0 rgba(27,31,36,0.08) !important;
            }
        `);

        // 获取选择的内容并转换为Markdown（支持多选）
        const parts = elements.map(el => (getSelectedContentAsMarkdown(el) || '').trim()).filter(Boolean);
        const joined = parts.join(`

---


`);
        let selectedContent = (parts.length > 1 ? `
` : '') + joined;

        // 收集所有需要上传的图片
        const allImages = [];
        elements.forEach(el => {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = el.innerHTML;
            htmlToMarkdown.convert(tempDiv.innerHTML);
            allImages.push(...htmlToMarkdown.images);
        });

        // 去重图片
        const uniqueImages = [];
        const seenSrcs = new Set();
        allImages.forEach(img => {
            if (!seenSrcs.has(img.src)) {
                seenSrcs.add(img.src);
                uniqueImages.push(img);
            }
        });

        dialog.innerHTML = `
            <h3>创建 CNB Issue (Markdown格式)</h3>
            <div>
                <label>标题:</label>
                <input class="cnb-control" type="text" id="cnb-issue-title" value="${escapeHtml(pageTitle)}" placeholder="输入Issue标题">
            </div>
            <div>
                <label>Markdown内容:</label>
                <textarea class="cnb-control" id="cnb-issue-content" placeholder="Markdown内容将自动生成">## 出处
**URL:** ${escapeHtml(pageUrl)}
**选择时间:** ${new Date().toLocaleString()}
${escapeHtml(selectedContent)}</textarea>
                ${uniqueImages.length > 0 ? `<div class="cnb-image-upload-toggle">
                    <label class="cnb-toggle-switch">
                        <input type="checkbox" id="cnb-upload-toggle" ${CONFIG.uploadEnabled ? 'checked' : ''}>
                        <span class="cnb-toggle-slider"></span>
                    </label>
                    <div class="cnb-hint" id="cnb-image-upload-status">检测到 ${uniqueImages.length} 张图片，点击创建时将自动上传</div>
                </div>` : ''}
                <div style="display: flex; align-items: center; gap: 20px; margin-top: 10px;">
                    <div class="cnb-image-upload-toggle" style="margin: 0;">
                        <label class="cnb-toggle-switch">
                            <input type="checkbox" id="cnb-edit-toggle">
                            <span class="cnb-toggle-slider"></span>
                        </label>
                        <span style="margin-right: 8px;">修改Issue</span>
                        <input class="cnb-control cnb-issue-number-input" type="number" id="cnb-issue-number" placeholder="Issue号" style="width: 80px; display: none; margin-left: 8px;">
                    </div>
                    <div class="cnb-image-upload-toggle" style="margin: 0;">
                        <label class="cnb-toggle-switch">
                            <input type="checkbox" id="cnb-comment-toggle">
                            <span class="cnb-toggle-slider"></span>
                        </label>
                        <span style="margin-right: 8px;">添加评论</span>
                    </div>
                </div>
            </div>
            <div>
                <label>标签:</label>
                <div id="cnb-issue-tags"></div>
            </div>
            <div class="cnb-issue-dialog-buttons">
                <button class="cnb-issue-btn-cancel">取消</button>
                <button class="cnb-issue-btn-done">创建完成Issue</button>
                <button class="cnb-issue-btn-confirm">创建Issue</button>
            </div>
        `;

        // 添加事件监听
        // 渲染标签为可选按钮
        const tagsContainer = dialog.querySelector('#cnb-issue-tags');
        let selectedTags = [];
        if (tagsContainer) {
            tagsContainer.innerHTML = '';
            const tags = Array.isArray(SAVED_TAGS) ? SAVED_TAGS : [];
            if (tags.length === 0) {
                const hint = document.createElement('div');
                hint.className = 'cnb-hint';
                hint.textContent = '在设置中添加标签后可在此选择';
                tagsContainer.appendChild(hint);
            } else {
                tags.forEach(tag => {
                    const btnTag = document.createElement('button');
                    btnTag.type = 'button';
                    btnTag.className = 'cnb-tag-btn';
                    btnTag.textContent = tag;
                    btnTag.addEventListener('click', () => {
                        const idx = selectedTags.indexOf(tag);
                        if (idx >= 0) {
                            selectedTags.splice(idx, 1);
                            btnTag.classList.remove('active');
                        } else {
                            selectedTags.push(tag);
                            btnTag.classList.add('active');
                        }
                    });
                    tagsContainer.appendChild(btnTag);
                });
            }
        }
        const cancelBtn = dialog.querySelector('.cnb-issue-btn-cancel');
        const confirmBtn = dialog.querySelector('.cnb-issue-btn-confirm');
        const doneBtn = dialog.querySelector('.cnb-issue-btn-done');
        const uploadToggle = dialog.querySelector('#cnb-upload-toggle');
        const editToggle = dialog.querySelector('#cnb-edit-toggle');
        const commentToggle = dialog.querySelector('#cnb-comment-toggle');
        const issueNumberInput = dialog.querySelector('#cnb-issue-number');

        // 监听上传开关变化，保存状态
        if (uploadToggle) {
            uploadToggle.addEventListener('change', () => {
                CONFIG.uploadEnabled = !!uploadToggle.checked;
                if (typeof GM_setValue === 'function') {
                    GM_setValue('cnbUploadEnabled', CONFIG.uploadEnabled);
                }
            });
        }

        // 监听编辑开关变化，显示/隐藏Issue号输入框
        if (editToggle && issueNumberInput) {
            editToggle.addEventListener('change', () => {
                issueNumberInput.style.display = editToggle.checked ? 'inline-block' : 'none';
                // 如果关闭编辑开关且评论开关已打开，则不允许关闭
                if (!editToggle.checked && commentToggle.checked) {
                    editToggle.checked = true;
                    issueNumberInput.style.display = 'inline-block';
                    if (typeof GM_notification === 'function') {
                        GM_notification({
                            text: '添加评论功能必须开启修改Issue',
                            title: 'CNB Issue工具',
                            timeout: 2000
                        });
                    }
                }
                updateButtonText();
            });
        }

        // 监听评论开关变化
        if (commentToggle && editToggle) {
            commentToggle.addEventListener('change', () => {
                if (commentToggle.checked) {
                    // 打开评论开关，必须同时打开编辑开关
                    if (!editToggle.checked) {
                        editToggle.checked = true;
                        if (issueNumberInput) {
                            issueNumberInput.style.display = 'inline-block';
                        }
                    }
                }
                updateButtonText();
            });
        }

        // 更新按钮文本的函数
        function updateButtonText() {
            const isEdit = editToggle ? editToggle.checked : false;
            const isComment = commentToggle ? commentToggle.checked : false;

            if (isComment) {
                confirmBtn.textContent = '添加评论';
            } else if (isEdit) {
                confirmBtn.textContent = '修改Issue';
            } else {
                confirmBtn.textContent = '创建Issue';
            }

            if (doneBtn) {
                if (isComment) {
                    doneBtn.textContent = '添加评论并完成';
                } else if (isEdit) {
                    doneBtn.textContent = '修改并完成';
                } else {
                    doneBtn.textContent = '创建完成Issue';
                }
            }
        }

        // 监听编辑开关变化
        if (editToggle) {
            editToggle.addEventListener('change', updateButtonText);
        }

        const closeDialog = () => {
            if (document.body.contains(overlay)) document.body.removeChild(overlay);
            if (document.body.contains(dialog)) document.body.removeChild(dialog);
        };

        overlay.addEventListener('click', closeDialog);
        cancelBtn.addEventListener('click', closeDialog);

        confirmBtn.addEventListener('click', () => {
            const title = dialog.querySelector('#cnb-issue-title').value;
            const content = dialog.querySelector('#cnb-issue-content').value;
            const uploadToggle = dialog.querySelector('#cnb-upload-toggle');
            const editToggle = dialog.querySelector('#cnb-edit-toggle');
            const commentToggle = dialog.querySelector('#cnb-comment-toggle');
            const issueNumberInput = dialog.querySelector('#cnb-issue-number');

            const shouldUpload = uploadToggle ? uploadToggle.checked : true;
            const shouldEdit = editToggle ? editToggle.checked : false;
            const shouldComment = commentToggle ? commentToggle.checked : false;
            const issueNumber = issueNumberInput ? issueNumberInput.value.trim() : '';

            const labels = Array.isArray(selectedTags) ? selectedTags.slice() : [];

            // 验证：如果要修改或评论Issue，必须输入Issue号
            if (shouldEdit || shouldComment) {
                if (!issueNumber) {
                    if (typeof GM_notification === 'function') {
                        GM_notification({
                            text: '请输入Issue号',
                            title: 'CNB Issue工具',
                            timeout: 3000
                        });
                    }
                    return;
                }
            }

            // 禁用按钮并显示加载状态
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<div class="cnb-issue-loading"></div>' + (shouldComment ? '添加评论中...' : (shouldEdit ? '修改中...' : '创建中...'));

            // 从编辑后的内容中重新检测图片
            const imagesInContent = extractImagesFromMarkdown(content);

            // 处理图片上传和Issue操作的逻辑
            const handleContentReady = (updatedContent) => {
                if (shouldComment) {
                    // 只添加评论，不修改Issue
                    addCommentToIssue(issueNumber, updatedContent, (commentSuccess) => {
                        closeDialog();
                    });
                } else if (shouldEdit) {
                    // 修改现有Issue
                    const updateData = { body: updatedContent, title: title };
                    updateIssue(issueNumber, updateData, (success) => {
                        if (success) {
                            closeDialog();
                        } else {
                            confirmBtn.disabled = false;
                            confirmBtn.innerHTML = '修改Issue';
                        }
                    });
                } else {
                    // 创建新Issue
                    createIssue(title, updatedContent, labels, (success) => {
                        if (success) {
                            closeDialog();
                        } else {
                            confirmBtn.disabled = false;
                            confirmBtn.innerHTML = '创建Issue';
                        }
                    });
                }
            };

            // 如果开启了上传且有图片，先上传图片
            if (shouldUpload && imagesInContent.length > 0) {
                const statusEl = dialog.querySelector('#cnb-image-upload-status');
                if (statusEl) statusEl.textContent = '正在上传图片...';

                uploadImagesAndReplace(content, imagesInContent, (updatedContent, errors) => {
                    if (errors && errors.length > 0) {
                        const failedCount = errors.filter(e => e.error).length;
                        const successCount = errors.length - failedCount;
                        if (statusEl) {
                            statusEl.textContent = `图片上传完成：成功 ${successCount} 张，失败 ${failedCount} 张`;
                        }
                        if (failedCount > 0) {
                            console.warn('部分图片上传失败:', errors.filter(e => e.error));
                        }
                    } else if (statusEl) {
                        statusEl.textContent = '图片上传完成';
                    }

                    handleContentReady(updatedContent);
                });
            } else {
                // 不上传图片或没有图片，直接处理Issue操作
                handleContentReady(content);
            }
        });

        if (doneBtn) {
            doneBtn.addEventListener('click', () => {
                const title = dialog.querySelector('#cnb-issue-title').value;
                const content = dialog.querySelector('#cnb-issue-content').value;
                const uploadToggle = dialog.querySelector('#cnb-upload-toggle');
                const editToggle = dialog.querySelector('#cnb-edit-toggle');
                const commentToggle = dialog.querySelector('#cnb-comment-toggle');
                const issueNumberInput = dialog.querySelector('#cnb-issue-number');

                const shouldUpload = uploadToggle ? uploadToggle.checked : true;
                const shouldEdit = editToggle ? editToggle.checked : false;
                const shouldComment = commentToggle ? commentToggle.checked : false;
                const issueNumber = issueNumberInput ? issueNumberInput.value.trim() : '';

                const labels = Array.isArray(selectedTags) ? selectedTags.slice() : [];

                // 验证：如果要修改或评论Issue，必须输入Issue号
                if (shouldEdit || shouldComment) {
                    if (!issueNumber) {
                        if (typeof GM_notification === 'function') {
                            GM_notification({
                                text: '请输入Issue号',
                                title: 'CNB Issue工具',
                                timeout: 3000
                            });
                        }
                        return;
                    }
                }

                doneBtn.disabled = true;
                confirmBtn.disabled = true;
                doneBtn.innerHTML = '<div class="cnb-issue-loading"></div>处理中...';

                const handleContentReady = (updatedContent) => {
                    if (shouldComment) {
                        // 只添加评论，然后关闭Issue
                        addCommentToIssue(issueNumber, updatedContent, (commentSuccess) => {
                            if (commentSuccess) {
                                closeIssue(issueNumber, 'completed', (ok) => {
                                    if (typeof GM_notification === 'function') {
                                        GM_notification({
                                            text: '评论已添加，Issue已标记为已完成',
                                            title: 'CNB Issue工具',
                                            timeout: 3000
                                        });
                                    }
                                    if (document.body.contains(overlay)) document.body.removeChild(overlay);
                                    if (document.body.contains(dialog)) document.body.removeChild(dialog);
                                });
                            } else {
                                doneBtn.disabled = false;
                                confirmBtn.disabled = false;
                                doneBtn.innerHTML = '添加评论并完成';
                            }
                        });
                    } else if (shouldEdit) {
                        // 修改现有Issue并完成
                        const updateData = { body: updatedContent, title: title, state: 'closed', state_reason: 'completed' };
                        updateIssue(issueNumber, updateData, (success) => {
                            if (success) {
                                if (typeof GM_notification === 'function') {
                                    GM_notification({
                                        text: 'Issue已修改并完成',
                                        title: 'CNB Issue工具',
                                        timeout: 3000
                                    });
                                }
                                if (document.body.contains(overlay)) document.body.removeChild(overlay);
                                if (document.body.contains(dialog)) document.body.removeChild(dialog);
                            } else {
                                doneBtn.disabled = false;
                                confirmBtn.disabled = false;
                                doneBtn.innerHTML = '修改并完成';
                            }
                        });
                    } else {
                        // 创建新Issue并完成
                        createIssue(title, updatedContent, labels, (success, issueId) => {
                            if (success && issueId != null) {
                                closeIssue(issueId, 'completed', (ok) => {
                                    if (!ok) {
                                        doneBtn.disabled = false;
                                        confirmBtn.disabled = false;
                                        doneBtn.innerHTML = '创建完成Issue';
                                        return;
                                    }
                                    if (typeof GM_notification === 'function') {
                                        GM_notification({
                                            text: 'Issue已标记为已完成（closed: completed）',
                                            title: 'CNB Issue工具',
                                            timeout: 3000
                                        });
                                    }
                                    if (document.body.contains(overlay)) document.body.removeChild(overlay);
                                    if (document.body.contains(dialog)) document.body.removeChild(dialog);
                                });
                            } else {
                                doneBtn.disabled = false;
                                confirmBtn.disabled = false;
                                doneBtn.innerHTML = '创建完成Issue';
                            }
                        });
                    }
                };

                // 从编辑后的内容中重新检测图片
                const imagesInContent = extractImagesFromMarkdown(content);

                // 如果开启了上传且有图片，先上传图片
                if (shouldUpload && imagesInContent.length > 0) {
                    const statusEl = dialog.querySelector('#cnb-image-upload-status');
                    if (statusEl) statusEl.textContent = '正在上传图片...';

                    uploadImagesAndReplace(content, imagesInContent, (updatedContent, errors) => {
                        if (errors && errors.length > 0) {
                            const failedCount = errors.filter(e => e.error).length;
                            const successCount = errors.length - failedCount;
                            if (statusEl) {
                                statusEl.textContent = `图片上传完成：成功 ${successCount} 张，失败 ${failedCount} 张`;
                            }
                            if (failedCount > 0) {
                                console.warn('部分图片上传失败:', errors.filter(e => e.error));
                            }
                        } else if (statusEl) {
                            statusEl.textContent = '图片上传完成';
                        }

                        handleContentReady(updatedContent);
                    });
                } else {
                    handleContentReady(content);
                }
            });
        }

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);

        // 自动聚焦到标题输入框
        dialog.querySelector('#cnb-issue-title').focus();
        dialog.querySelector('#cnb-issue-title').select();
    }

    // 获取选择区域的内容并转换为Markdown
    function getSelectedContentAsMarkdown(element) {
        if (!element) return '';

        try {
            // 获取元素的HTML内容
            const htmlContent = element.innerHTML;

            // 转换为Markdown
            const markdownContent = htmlToMarkdown.convert(htmlContent);

            // 清理和格式化
            return cleanMarkdownContent(markdownContent);
        } catch (error) {
            console.error('转换Markdown失败:', error);
            // 如果转换失败，回退到纯文本
            return element.textContent || element.innerText || '';
        }
    }

    // 清理Markdown内容（用于显示）
    function cleanMarkdownContent(markdown) {
        // 删除表情图片（以 ![:grimacing:] 格式）
        markdown = markdown.replace(/!\[:[^\]]+\]\([^)]+\)/g, '');
        // 将复杂图片链接格式转换为纯图片格式
        markdown = markdown.replace(/\[!\[([^\]]*)\]\(([^)]+)\)[^\]]*\]\([^)]+\)/g, '![$1]($2)');

        // 删除引用块中的空行（> 后面只有空格或空行的）
        markdown = markdown.replace(/^>\s*$/gm, '');

        // 删除代码块结束标记前的空行（只处理 \n``` 这种出现在代码块结束前的情况）
        markdown = markdown.replace(/\n{2,}```/g, '\n```');

        // 多个空行合并为两个
        markdown = markdown.replace(/\n{3,}/g, '\n\n');

        // 去除首尾空白
        markdown = markdown.replace(/^\s+|\s+$/g, '');

        return markdown;
    }

    // 清理Markdown内容（用于复制，更激进的换行处理）
    function cleanMarkdownContentForCopy(markdown) {
        // 删除表情图片（以 ![:grimacing:] 格式）
        markdown = markdown.replace(/!\[:[^\]]+\]\([^)]+\)/g, '');
        // 将复杂图片链接格式转换为纯图片格式
        markdown = markdown.replace(/\[!\[([^\]]*)\]\(([^)]+)\)[^\]]*\]\([^)]+\)/g, '![$1]($2)');

        // 删除引用块中的空行（> 后面只有空格或空行的）
        markdown = markdown.replace(/^>\s*$/gm, '');

        // 删除代码块结束标记前的空行（只处理 \n``` 这种出现在代码块结束前的情况）
        markdown = markdown.replace(/\n{2,}```/g, '\n```');

        // 多个空行合并为两个
        markdown = markdown.replace(/\n{3,}/g, '\n\n');

        // 去除首尾空白
        markdown = markdown.replace(/^\s+|\s+$/g, '');

        return markdown;
    }

    // 轻量 Markdown 转 HTML（基础语法）
    function markdownToHtml(md) {
        if (!md) return '';
        let placeholders = [];
        // 保护代码块 ```lang\n...\n```
        md = md.replace(/```(\w+)?\n([\s\S]*?)```/g, function(_, lang, code) {
            const idx = placeholders.length;
            const esc = (s)=>String(s).replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>');
            placeholders.push(`<pre><code class="language-${lang||''}">${esc(code)}</code></pre>`);
            return `\u0000BLOCK${idx}\u0000`;
        });
        // 保护行内代码 `code`
        md = md.replace(/`([^`\n]+)`/g, function(_, code){
            const idx = placeholders.length;
            const esc = (s)=>String(s).replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>');
            placeholders.push(`<code>${esc(code)}</code>`);
            return `\u0000INLINE${idx}\u0000`;
        });
        // 先整体转义，避免 HTML 注入
        md = md.replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>');
        // 图片与链接
        md = md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
        md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        // 粗体/斜体
        md = md.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        md = md.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        // 标题
        md = md.replace(/^(#{6})\s+(.+)$/gm, '<h6>$2</h6>')
               .replace(/^(#{5})\s+(.+)$/gm, '<h5>$2</h5>')
               .replace(/^(#{4})\s+(.+)$/gm, '<h4>$2</h4>')
               .replace(/^(#{3})\s+(.+)$/gm, '<h3>$2</h3>')
               .replace(/^(#{2})\s+(.+)$/gm, '<h2>$2</h2>')
               .replace(/^(#{1})\s+(.+)$/gm, '<h1>$2</h1>');
        // 水平线
        md = md.replace(/^\s*[-*_]{3,}\s*$/gm, '<hr>');
        // 引用
        md = md.replace(/^(?:>\s?(.*))$/gm, '<blockquote><p>$1</p></blockquote>');
        // 列表（连续项聚合）
        md = md.replace(/(?:^(?:\s*-\s+.+)\n?)+/gm, function(block){
            const items = block.trim().split(/\n/).map(l => l.replace(/^\s*-\s+/, '').trim());
            return '<ul>' + items.map(i=>`<li>${i}</li>`).join('') + '</ul>';
        });
        md = md.replace(/(?:^(?:\s*\d+\.\s+.+)\n?)+/gm, function(block){
            const items = block.trim().split(/\n/).map(l => l.replace(/^\s*\d+\.\s+/, '').trim());
            return '<ol>' + items.map(i=>`<li>${i}</li>`).join('') + '</ol>';
        });
        // 段落：使用换行分段，避免已是块级元素再次包裹
        const blocks = md.split('\n')
            .filter(seg => seg.trim().length > 0) // 移除空行
            .map(seg=>{
                if (/^\s*<(h\d|ul|ol|li|pre|blockquote|hr)/i.test(seg)) return seg;
                return '<p>' + seg + '</p>';
            });
        let html = blocks.join('');
        // 还原占位
        html = html.replace(/\u0000(INLINE|BLOCK)(\d+)\u0000/g, (_, type, i) => placeholders[Number(i)] || '');
        return html;
    }

    // HTML转义
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 处理微博选择：截图并创建Issue
    function handleWeiboSelection(elements, pageUrl, pageTitle) {
        // 加载 html2canvas 库（如果未加载）
        if (typeof html2canvas === 'undefined') {
            loadHtml2CanvasLibrary(() => {
                processWeiboCapture(elements, pageUrl, pageTitle);
            });
        } else {
            processWeiboCapture(elements, pageUrl, pageTitle);
        }
    }

    // 加载 html2canvas 库
    function loadHtml2CanvasLibrary(callback) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        script.onload = callback;
        script.onerror = () => {
            if (typeof GM_notification === 'function') {
                GM_notification({
                    text: 'html2canvas 库加载失败',
                    title: 'CNB Issue工具',
                    timeout: 3000
                });
            }
        };
        document.head.appendChild(script);
    }

    // 处理微博截图
    function processWeiboCapture(elements, pageUrl, pageTitle) {
        // 提取出处信息（从选择区域中查找时间链接）
        let sourceUrl = pageUrl;
        let sourceTime = new Date().toLocaleString();

        // 遍历选择区域，查找时间链接
        for (const element of elements) {
            const timeLink = element.querySelector('a[class*="_time"]');
            if (timeLink && timeLink.href) {
                sourceUrl = timeLink.href;
                // 从 title 属性中提取时间
                if (timeLink.title) {
                    sourceTime = timeLink.title;
                }
                break;
            }
        }

        // 提取标题（从选择区域中查找微博正文）
        let weiboTitle = pageTitle;
        const wbtextElement = elements[0].querySelector('[class*="_wbtext"]');
        if (wbtextElement) {
            const textContent = wbtextElement.textContent.trim();
            // 限制标题长度为100字符
            weiboTitle = textContent.length > 100 ? textContent.substring(0, 100) + '...' : textContent;
        }

        // 创建遮罩层和对话框
        const overlay = document.createElement('div');
        overlay.className = 'cnb-issue-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'cnb-issue-dialog';

        dialog.innerHTML = `
            <h3>创建 CNB Issue (微博截图)</h3>
            <div>
                <label>标题:</label>
                <input class="cnb-control" type="text" id="cnb-issue-title" value="${escapeHtml(weiboTitle)}" placeholder="输入Issue标题">
            </div>
            <div>
                <label>出处信息:</label>
                <textarea class="cnb-control" id="cnb-issue-content" readonly style="height: 120px;">## 出处
**URL:** ${escapeHtml(sourceUrl)}
**选择时间:** ${sourceTime}
下面是生成的图片</textarea>
                <div class="cnb-hint" id="cnb-capture-status">点击创建时将自动生成并上传截图</div>
            </div>
            <div>
                <label>标签:</label>
                <div id="cnb-issue-tags"></div>
            </div>
            <div style="display: flex; align-items: center; gap: 20px; margin-top: 10px;">
                <div class="cnb-image-upload-toggle" style="margin: 0;">
                    <label class="cnb-toggle-switch">
                        <input type="checkbox" id="cnb-edit-toggle">
                        <span class="cnb-toggle-slider"></span>
                    </label>
                    <span style="margin-right: 8px;">修改Issue</span>
                    <input class="cnb-control cnb-issue-number-input" type="number" id="cnb-issue-number" placeholder="Issue号" style="width: 80px; display: none; margin-left: 8px;">
                </div>
                <div class="cnb-image-upload-toggle" style="margin: 0;">
                    <label class="cnb-toggle-switch">
                        <input type="checkbox" id="cnb-comment-toggle">
                        <span class="cnb-toggle-slider"></span>
                    </label>
                    <span style="margin-right: 8px;">添加评论</span>
                </div>
            </div>
            <div class="cnb-issue-dialog-buttons">
                <button class="cnb-issue-btn-cancel">取消</button>
                <button class="cnb-issue-btn-done">创建完成Issue</button>
                <button class="cnb-issue-btn-confirm">创建Issue</button>
            </div>
        `;

        // 渲染标签选择
        const tagsContainer = dialog.querySelector('#cnb-issue-tags');
        let selectedTags = [];
        if (tagsContainer) {
            tagsContainer.innerHTML = '';
            const tags = Array.isArray(SAVED_TAGS) ? SAVED_TAGS : [];
            if (tags.length === 0) {
                const hint = document.createElement('div');
                hint.className = 'cnb-hint';
                hint.textContent = '在设置中添加标签后可在此选择';
                tagsContainer.appendChild(hint);
            } else {
                tags.forEach(tag => {
                    const btnTag = document.createElement('button');
                    btnTag.type = 'button';
                    btnTag.className = 'cnb-tag-btn';
                    btnTag.textContent = tag;
                    btnTag.addEventListener('click', () => {
                        const idx = selectedTags.indexOf(tag);
                        if (idx >= 0) {
                            selectedTags.splice(idx, 1);
                            btnTag.classList.remove('active');
                        } else {
                            selectedTags.push(tag);
                            btnTag.classList.add('active');
                        }
                    });
                    tagsContainer.appendChild(btnTag);
                });
            }
        }

        const cancelBtn = dialog.querySelector('.cnb-issue-btn-cancel');
        const confirmBtn = dialog.querySelector('.cnb-issue-btn-confirm');
        const doneBtn = dialog.querySelector('.cnb-issue-btn-done');
        const editToggle = dialog.querySelector('#cnb-edit-toggle');
        const commentToggle = dialog.querySelector('#cnb-comment-toggle');
        const issueNumberInput = dialog.querySelector('#cnb-issue-number');

        // 监听编辑开关变化，显示/隐藏Issue号输入框
        if (editToggle && issueNumberInput) {
            editToggle.addEventListener('change', () => {
                issueNumberInput.style.display = editToggle.checked ? 'inline-block' : 'none';
                // 如果关闭编辑开关且评论开关已打开，则不允许关闭
                if (!editToggle.checked && commentToggle.checked) {
                    editToggle.checked = true;
                    issueNumberInput.style.display = 'inline-block';
                    if (typeof GM_notification === 'function') {
                        GM_notification({
                            text: '添加评论功能必须开启修改Issue',
                            title: 'CNB Issue工具',
                            timeout: 2000
                        });
                    }
                }
                updateButtonText();
            });
        }

        // 监听评论开关变化
        if (commentToggle && editToggle) {
            commentToggle.addEventListener('change', () => {
                if (commentToggle.checked) {
                    // 打开评论开关，必须同时打开编辑开关
                    if (!editToggle.checked) {
                        editToggle.checked = true;
                        if (issueNumberInput) {
                            issueNumberInput.style.display = 'inline-block';
                        }
                    }
                }
                updateButtonText();
            });
        }

        // 更新按钮文本的函数
        function updateButtonText() {
            const isEdit = editToggle ? editToggle.checked : false;
            const isComment = commentToggle ? commentToggle.checked : false;

            if (isComment) {
                confirmBtn.textContent = '添加评论';
            } else if (isEdit) {
                confirmBtn.textContent = '修改Issue';
            } else {
                confirmBtn.textContent = '创建Issue';
            }

            if (doneBtn) {
                if (isComment) {
                    doneBtn.textContent = '添加评论并完成';
                } else if (isEdit) {
                    doneBtn.textContent = '修改并完成';
                } else {
                    doneBtn.textContent = '创建完成Issue';
                }
            }
        }

        const closeDialog = () => {
            if (document.body.contains(overlay)) document.body.removeChild(overlay);
            if (document.body.contains(dialog)) document.body.removeChild(dialog);
        };

        overlay.addEventListener('click', closeDialog);
        cancelBtn.addEventListener('click', closeDialog);

        // 创建并完成 Issue
        doneBtn.addEventListener('click', async () => {
            const title = dialog.querySelector('#cnb-issue-title').value;
            const content = dialog.querySelector('#cnb-issue-content').value;
            const editToggle = dialog.querySelector('#cnb-edit-toggle');
            const commentToggle = dialog.querySelector('#cnb-comment-toggle');
            const issueNumberInput = dialog.querySelector('#cnb-issue-number');

            const shouldEdit = editToggle ? editToggle.checked : false;
            const shouldComment = commentToggle ? commentToggle.checked : false;
            const issueNumber = issueNumberInput ? issueNumberInput.value.trim() : '';

            const labels = Array.isArray(selectedTags) ? selectedTags.slice() : [];

            // 验证：如果要修改或评论Issue，必须输入Issue号
            if (shouldEdit || shouldComment) {
                if (!issueNumber) {
                    if (typeof GM_notification === 'function') {
                        GM_notification({
                            text: '请输入Issue号',
                            title: 'CNB Issue工具',
                            timeout: 3000
                        });
                    }
                    return;
                }
            }

            doneBtn.disabled = true;
            confirmBtn.disabled = true;
            doneBtn.innerHTML = '<div class="cnb-issue-loading"></div>处理中...';

            // 生成截图
            const statusEl = dialog.querySelector('#cnb-capture-status');
            if (statusEl) statusEl.textContent = '正在生成截图...';

            try {
                // 先计算截图区域（在修改样式之前获取准确坐标）
                const bounds = elements.map(el => el.getBoundingClientRect());
                const minX = Math.min(...bounds.map(b => b.left)) - 10;
                const minY = Math.min(...bounds.map(b => b.top)) - 10;
                const maxX = Math.max(...bounds.map(b => b.right)) + 10;
                const maxY = Math.max(...bounds.map(b => b.bottom)) + 10;

                // 临时保存原始样式
                const originalStyles = [];
                elements.forEach(el => {
                    originalStyles.push({
                        el: el,
                        outline: el.style.outline,
                        boxShadow: el.style.boxShadow,
                        zIndex: el.style.zIndex
                    });
                    // 移除选择样式
                    el.style.outline = 'none';
                    el.style.boxShadow = 'none';
                    // 不要修改 zIndex，避免影响布局
                    // el.style.zIndex = '999999';
                });

                // 预加载选中区域内的所有图片，解决跨域图片显示空白的问题
                // 使用 GM_xmlhttpRequest 来获取图片数据，绕过跨域限制
                const imagePromises = [];

                elements.forEach(el => {
                    const imgs = el.querySelectorAll('img');
                    imgs.forEach(img => {
                        if (img.src && !img.src.startsWith('data:')) {
                            const promise = new Promise((resolve) => {
                                GM_xmlhttpRequest({
                                    method: 'GET',
                                    url: img.src,
                                    responseType: 'blob',
                                    headers: {
                                        'Referer': window.location.href
                                    },
                                    onload: (response) => {
                                        try {
                                            if (response.response && response.response instanceof Blob) {
                                                const reader = new FileReader();
                                                reader.onload = () => {
                                                    img.src = reader.result;
                                                    console.log('Converted image with GM_xmlhttpRequest:', img.src.substring(0, 50) + '...');
                                                    resolve();
                                                };
                                                reader.onerror = () => {
                                                    console.warn('Failed to read blob');
                                                    resolve();
                                                };
                                                reader.readAsDataURL(response.response);
                                            } else {
                                                resolve();
                                            }
                                        } catch (e) {
                                            console.warn('Failed to convert image:', e);
                                            resolve();
                                        }
                                    },
                                    onerror: () => {
                                        console.warn('Failed to fetch image with GM_xmlhttpRequest:', img.src);
                                        resolve();
                                    }
                                });
                            });
                            imagePromises.push(promise);
                        }
                    });
                });

                // 等待所有图片加载或转换完成
                await Promise.all(imagePromises);

                // 等待元素重新渲染
                await new Promise(resolve => setTimeout(resolve, 500));

                // 使用 html2canvas 生成截图
                const canvas = await html2canvas(document.body, {
                    backgroundColor: '#ffffff',
                    scale: 2,
                    useCORS: true,
                    allowTaint: true,
                    logging: false,
                    x: minX,
                    y: minY,
                    width: maxX - minX,
                    height: maxY - minY,
                    ignoreElements: (element) => {
                        // 忽略对话框
                        return element.classList.contains('cnb-issue-dialog') ||
                               element.classList.contains('cnb-issue-overlay') ||
                               element.closest('.cnb-issue-dialog') ||
                               element.closest('.cnb-issue-overlay');
                    }
                });

                // 恢复原始样式
                originalStyles.forEach(item => {
                    item.el.style.outline = item.outline;
                    item.el.style.boxShadow = item.boxShadow;
                    item.el.style.zIndex = item.zIndex;
                });

                // 转换为 blob
                const blob = await new Promise((resolve, reject) => {
                    canvas.toBlob((blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('Canvas toBlob failed'));
                        }
                    }, 'image/png');
                });

                if (!blob) {
                    doneBtn.disabled = false;
                    confirmBtn.disabled = false;
                    doneBtn.innerHTML = '创建完成Issue';
                    if (typeof GM_notification === 'function') {
                        GM_notification({
                            text: '截图生成失败',
                            title: 'CNB Issue工具',
                            timeout: 3000
                        });
                    }
                    return;
                }

                if (statusEl) statusEl.textContent = '正在上传截图...';
                doneBtn.innerHTML = '<div class="cnb-issue-loading"></div>上传中...';

                // 上传截图
                const fileName = `weibo_${Date.now()}.png`;
                requestUploadToken(fileName, blob.size, (uploadInfo, tokenError) => {
                    if (tokenError || !uploadInfo) {
                        doneBtn.disabled = false;
                        confirmBtn.disabled = false;
                        doneBtn.innerHTML = '创建完成Issue';
                        if (typeof GM_notification === 'function') {
                            GM_notification({
                                text: '获取上传凭证失败: ' + tokenError,
                                title: 'CNB Issue工具',
                                timeout: 5000
                            });
                        }
                        return;
                    }

                    uploadImageToOss(uploadInfo, blob, (imageUrl, uploadError) => {
                        if (uploadError || !imageUrl) {
                            doneBtn.disabled = false;
                            confirmBtn.disabled = false;
                            doneBtn.innerHTML = '创建完成Issue';
                            if (typeof GM_notification === 'function') {
                                GM_notification({
                                    text: '截图上传失败: ' + uploadError,
                                    title: 'CNB Issue工具',
                                    timeout: 5000
                                });
                            }
                            return;
                        }

                        // 更新内容为图片
                        const updatedContent = content + '\n\n' + `![微博截图](${imageUrl})`;

                        // 创建并完成 Issue 或修改 Issue 或添加评论
                        if (statusEl) {
                            if (shouldComment) {
                                statusEl.textContent = '正在添加评论...';
                            } else if (shouldEdit) {
                                statusEl.textContent = '正在修改Issue...';
                            } else {
                                statusEl.textContent = '正在创建Issue...';
                            }
                        }
                        doneBtn.innerHTML = '<div class="cnb-issue-loading"></div>' + (shouldComment ? '添加评论中...' : (shouldEdit ? '修改中...' : '创建中...'));

                        const handleIssueOperation = () => {
                            if (shouldComment) {
                                // 只添加评论，然后关闭Issue
                                addCommentToIssue(issueNumber, updatedContent, (commentSuccess) => {
                                    if (commentSuccess) {
                                        closeIssue(issueNumber, 'completed', (ok) => {
                                            if (typeof GM_notification === 'function') {
                                                GM_notification({
                                                    text: '评论已添加，Issue已标记为已完成',
                                                    title: 'CNB Issue工具',
                                                    timeout: 3000
                                                });
                                            }
                                            closeDialog();
                                        });
                                    } else {
                                        doneBtn.disabled = false;
                                        confirmBtn.disabled = false;
                                        doneBtn.innerHTML = '添加评论并完成';
                                    }
                                });
                            } else if (shouldEdit) {
                                // 修改现有Issue
                                const updateData = { body: updatedContent, title: title, state: 'closed', state_reason: 'completed' };
                                updateIssue(issueNumber, updateData, (success) => {
                                    if (success) {
                                        if (typeof GM_notification === 'function') {
                                            GM_notification({
                                                text: 'Issue已修改并完成',
                                                title: 'CNB Issue工具',
                                                timeout: 3000
                                            });
                                        }
                                        closeDialog();
                                    } else {
                                        doneBtn.disabled = false;
                                        confirmBtn.disabled = false;
                                        doneBtn.innerHTML = '修改并完成';
                                    }
                                });
                            } else {
                                // 创建新Issue
                                createIssue(title, updatedContent, labels, (success, issueId) => {
                                    if (success && issueId != null) {
                                        closeIssue(issueId, 'completed', (ok) => {
                                            if (!ok) {
                                                doneBtn.disabled = false;
                                                confirmBtn.disabled = false;
                                                doneBtn.innerHTML = '创建完成Issue';
                                                return;
                                            }
                                            if (typeof GM_notification === 'function') {
                                                GM_notification({
                                                    text: 'Issue已标记为已完成（closed: completed）',
                                                    title: 'CNB Issue工具',
                                                    timeout: 3000
                                                });
                                            }
                                            closeDialog();
                                        });
                                    } else {
                                        doneBtn.disabled = false;
                                        confirmBtn.disabled = false;
                                        doneBtn.innerHTML = '创建完成Issue';
                                    }
                                });
                            }
                        };

                        handleIssueOperation();
                    });
                });
            } catch (error) {
                console.error('html2canvas error:', error);
                doneBtn.disabled = false;
                confirmBtn.disabled = false;
                doneBtn.innerHTML = '创建完成Issue';
                if (typeof GM_notification === 'function') {
                    GM_notification({
                        text: '截图生成失败: ' + error.message,
                        title: 'CNB Issue工具',
                        timeout: 5000
                    });
                }
            }
        });

        // 创建 Issue
        confirmBtn.addEventListener('click', async () => {
            const title = dialog.querySelector('#cnb-issue-title').value;
            const content = dialog.querySelector('#cnb-issue-content').value;
            const editToggle = dialog.querySelector('#cnb-edit-toggle');
            const commentToggle = dialog.querySelector('#cnb-comment-toggle');
            const issueNumberInput = dialog.querySelector('#cnb-issue-number');

            const shouldEdit = editToggle ? editToggle.checked : false;
            const shouldComment = commentToggle ? commentToggle.checked : false;
            const issueNumber = issueNumberInput ? issueNumberInput.value.trim() : '';

            const labels = Array.isArray(selectedTags) ? selectedTags.slice() : [];

            // 验证：如果要修改或评论Issue，必须输入Issue号
            if (shouldEdit || shouldComment) {
                if (!issueNumber) {
                    if (typeof GM_notification === 'function') {
                        GM_notification({
                            text: '请输入Issue号',
                            title: 'CNB Issue工具',
                            timeout: 3000
                        });
                    }
                    return;
                }
            }

            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<div class="cnb-issue-loading"></div>生成截图中...';

            // 生成截图
            const statusEl = dialog.querySelector('#cnb-capture-status');
            if (statusEl) statusEl.textContent = '正在生成截图...';

            try {
                // 先计算截图区域（在修改样式之前获取准确坐标）
                const bounds = elements.map(el => el.getBoundingClientRect());
                const minX = Math.min(...bounds.map(b => b.left)) - 10;
                const minY = Math.min(...bounds.map(b => b.top)) - 10;
                const maxX = Math.max(...bounds.map(b => b.right)) + 10;
                const maxY = Math.max(...bounds.map(b => b.bottom)) + 10;

                // 使用原始元素直接截图，不克隆（避免丢失动态加载的内容）
                // 临时保存原始样式
                const originalStyles = [];
                elements.forEach(el => {
                    originalStyles.push({
                        el: el,
                        outline: el.style.outline,
                        boxShadow: el.style.boxShadow,
                        zIndex: el.style.zIndex
                    });
                    // 移除选择样式
                    el.style.outline = 'none';
                    el.style.boxShadow = 'none';
                    // 不要修改 zIndex，避免影响布局
                    // el.style.zIndex = '999999';
                });

            // 预加载选中区域内的所有图片，解决跨域图片显示空白的问题
            // 使用 GM_xmlhttpRequest 来获取图片数据，绕过跨域限制
            const imagePromises = [];

            elements.forEach(el => {
                const imgs = el.querySelectorAll('img');
                imgs.forEach(img => {
                    if (img.src && !img.src.startsWith('data:')) {
                        const promise = new Promise((resolve) => {
                            GM_xmlhttpRequest({
                                method: 'GET',
                                url: img.src,
                                responseType: 'blob',
                                headers: {
                                    'Referer': window.location.href
                                },
                                onload: (response) => {
                                    try {
                                        if (response.response && response.response instanceof Blob) {
                                            const reader = new FileReader();
                                            reader.onload = () => {
                                                img.src = reader.result;
                                                console.log('Converted image with GM_xmlhttpRequest:', img.src.substring(0, 50) + '...');
                                                resolve();
                                            };
                                            reader.onerror = () => {
                                                console.warn('Failed to read blob');
                                                resolve();
                                            };
                                            reader.readAsDataURL(response.response);
                                        } else {
                                            resolve();
                                        }
                                    } catch (e) {
                                        console.warn('Failed to convert image:', e);
                                        resolve();
                                    }
                                },
                                onerror: () => {
                                    console.warn('Failed to fetch image with GM_xmlhttpRequest:', img.src);
                                    resolve();
                                }
                            });
                        });
                        imagePromises.push(promise);
                    }
                });
            });

            // 等待所有图片加载或转换完成
            await Promise.all(imagePromises);

            // 等待元素重新渲染
            await new Promise(resolve => setTimeout(resolve, 500));

            // 使用 html2canvas 生成截图（使用之前计算的坐标）
            const canvas = await html2canvas(document.body, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                allowTaint: true,
                logging: false,
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
                ignoreElements: (element) => {
                    // 忽略对话框
                    return element.classList.contains('cnb-issue-dialog') || element.classList.contains('cnb-issue-overlay');
                }
            });

            // 恢复原始样式
            originalStyles.forEach(item => {
                item.el.style.outline = item.outline;
                item.el.style.boxShadow = item.boxShadow;
                item.el.style.zIndex = item.zIndex;
            });

                // 转换为 blob
                const blob = await new Promise((resolve, reject) => {
                    canvas.toBlob((blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('Canvas toBlob failed'));
                        }
                    }, 'image/png');
                });

                if (!blob) {
                    confirmBtn.disabled = false;
                    confirmBtn.innerHTML = '创建Issue';
                    if (typeof GM_notification === 'function') {
                        GM_notification({
                            text: '截图生成失败',
                            title: 'CNB Issue工具',
                            timeout: 3000
                        });
                    }
                    return;
                }

                if (statusEl) statusEl.textContent = '正在上传截图...';
                confirmBtn.innerHTML = '<div class="cnb-issue-loading"></div>上传中...';

                // 上传截图
                const fileName = `weibo_${Date.now()}.png`;
                requestUploadToken(fileName, blob.size, (uploadInfo, tokenError) => {
                    if (tokenError || !uploadInfo) {
                        confirmBtn.disabled = false;
                        confirmBtn.innerHTML = '创建Issue';
                        if (typeof GM_notification === 'function') {
                            GM_notification({
                                text: '获取上传凭证失败: ' + tokenError,
                                title: 'CNB Issue工具',
                                timeout: 5000
                            });
                        }
                        return;
                    }

                    uploadImageToOss(uploadInfo, blob, (imageUrl, uploadError) => {
                        if (uploadError || !imageUrl) {
                            confirmBtn.disabled = false;
                            confirmBtn.innerHTML = '创建Issue';
                            if (typeof GM_notification === 'function') {
                                GM_notification({
                                    text: '截图上传失败: ' + uploadError,
                                    title: 'CNB Issue工具',
                                    timeout: 5000
                                });
                            }
                            return;
                        }

                        // 更新内容为图片
                        const updatedContent = content + '\n\n' + `![微博截图](${imageUrl})`;

                        // 创建 Issue 或修改 Issue 或添加评论
                        if (statusEl) {
                            if (shouldComment) {
                                statusEl.textContent = '正在添加评论...';
                            } else if (shouldEdit) {
                                statusEl.textContent = '正在修改Issue...';
                            } else {
                                statusEl.textContent = '正在创建Issue...';
                            }
                        }
                        confirmBtn.innerHTML = '<div class="cnb-issue-loading"></div>' + (shouldComment ? '添加评论中...' : (shouldEdit ? '修改中...' : '创建中...'));

                        const handleIssueOperation = () => {
                            if (shouldComment) {
                                // 只添加评论，不修改Issue
                                addCommentToIssue(issueNumber, updatedContent, (commentSuccess) => {
                                    closeDialog();
                                });
                            } else if (shouldEdit) {
                                // 修改现有Issue
                                const updateData = { body: updatedContent, title: title };
                                updateIssue(issueNumber, updateData, (success) => {
                                    if (success) {
                                        closeDialog();
                                    } else {
                                        confirmBtn.disabled = false;
                                        confirmBtn.innerHTML = '修改Issue';
                                    }
                                });
                            } else {
                                // 创建新Issue
                                createIssue(title, updatedContent, labels, (success) => {
                                    if (success) {
                                        closeDialog();
                                    } else {
                                        confirmBtn.disabled = false;
                                        confirmBtn.innerHTML = '创建Issue';
                                    }
                                });
                            }
                        };

                        handleIssueOperation();
                    });
                });
            } catch (error) {
                console.error('html2canvas error:', error);
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '创建Issue';
                if (typeof GM_notification === 'function') {
                    GM_notification({
                        text: '截图生成失败: ' + error.message,
                        title: 'CNB Issue工具',
                        timeout: 5000
                    });
                }
            }
        });

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);

        // 自动聚焦到标题输入框
        dialog.querySelector('#cnb-issue-title').focus();
        dialog.querySelector('#cnb-issue-title').select();
    }

    // 设置弹窗
    function openSettingsDialog() {
        // 单例：若已存在，先移除旧实例
        try {
            if (__CNB_SETTINGS_OVERLAY && __CNB_SETTINGS_OVERLAY.parentNode) __CNB_SETTINGS_OVERLAY.remove();
            if (__CNB_SETTINGS_DIALOG && __CNB_SETTINGS_DIALOG.parentNode) __CNB_SETTINGS_DIALOG.remove();
        } catch (_) {}
        const overlay = document.createElement('div');
        overlay.className = 'cnb-issue-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'cnb-issue-dialog';
        __CNB_SETTINGS_OVERLAY = overlay;
        __CNB_SETTINGS_DIALOG = dialog;

        const currentRepo = CONFIG.repoPath || '';
        const currentToken = CONFIG.accessToken || '';
        const currentHotkey = START_HOTKEY || '';
        const currentHotkeyEnabled = !!HOTKEY_ENABLED;
        let currentClipIssue = '';
        try {
            if (typeof GM_getValue === 'function') {
                const v = GM_getValue('cnbClipboardIssue', '');
                currentClipIssue = (v == null) ? '' : String(v);
            }
        } catch (_) {}

        dialog.innerHTML = `
            <button class="cnb-dialog-close" title="关闭" style="position:absolute; right:10px; top:10px; border:none; background:transparent; color:#000; font-size:20px; line-height:1; cursor:pointer; font-weight:700;">×</button>
            <h3>CNB 设置</h3>
            <div>
                <label>仓库路径 (owner/repo):</label>
                <input class="cnb-control" type="text" id="cnb-setting-repo" placeholder="例如: IIIStudio/Demo" value="${escapeHtml(currentRepo)}">
            </div>
            <div>
                <label>访问令牌 (accessToken):</label>
                <input class="cnb-control" type="password" id="cnb-setting-token" placeholder="输入访问令牌" value="${escapeHtml(currentToken)}">
                <div class="cnb-hint">注意：上传图片需要访问令牌具有 <strong>repo-contents:rw</strong> 权限</div>
            </div>
            <div>
                <label>剪贴板位置（Issue编号）:</label>
                <input class="cnb-control" type="text" id="cnb-setting-clip-issue" placeholder="例如: 25（留空则隐藏剪贴板按钮）" value="${escapeHtml(currentClipIssue)}">
            </div>
            <div>
                <div class="cnb-flex" style="justify-content: space-between;">
                    <label>快捷键（开启选择模式）:</label>
                    <label class="cnb-switch" for="cnb-setting-hotkey-enabled" title="启用快捷键">
                        <input type="checkbox" id="cnb-setting-hotkey-enabled" ${currentHotkeyEnabled ? 'checked' : ''}>
                        <span class="cnb-switch-slider"></span>
                    </label>
                </div>
                <div class="cnb-flex">
                    <input class="cnb-control" type="text" id="cnb-setting-hotkey" placeholder="例如: Ctrl+Shift+Y" value="${escapeHtml(toDisplayHotkeyString(currentHotkey))}">
                </div>
            </div>
            <div>
                <label>标签管理:</label>
                <div class="cnb-flex">
                    <input class="cnb-control" type="text" id="cnb-setting-newtag" placeholder="输入新标签名称">
                    <button class="cnb-tag-addbtn" id="cnb-setting-addtag" type="button">添加标签</button>
                </div>
                <div id="cnb-setting-tags-list" class="cnb-tags-list"></div>
            </div>
        `;

        // 渲染与管理标签
        const tagsList = dialog.querySelector('#cnb-setting-tags-list');
        const newTagInput = dialog.querySelector('#cnb-setting-newtag');
        const addTagBtn = dialog.querySelector('#cnb-setting-addtag');
        const hotkeyInput = dialog.querySelector('#cnb-setting-hotkey');
        const hotkeyEnabledInput = dialog.querySelector('#cnb-setting-hotkey-enabled');
        const repoInput = dialog.querySelector('#cnb-setting-repo');
        const tokenInput = dialog.querySelector('#cnb-setting-token');
        const clipIssueInput = dialog.querySelector('#cnb-setting-clip-issue');

        // 仓库路径即时保存
        if (repoInput) {
            repoInput.addEventListener('input', () => {
                const repo = repoInput.value.trim();
                if (repo) {
                    CONFIG.repoPath = repo;
                    if (typeof GM_setValue === 'function') GM_setValue('repoPath', repo);
                }
            });
        }

        // 访问令牌即时保存
        if (tokenInput) {
            tokenInput.addEventListener('input', () => {
                const token = tokenInput.value.trim();
                if (token) {
                    CONFIG.accessToken = token;
                    if (typeof GM_setValue === 'function') GM_setValue('accessToken', token);
                }
            });
        }

        // 剪贴板位置即时保存并生效
        if (clipIssueInput) {
            const updateClipIssue = () => {
                const clipIssue = clipIssueInput.value.trim();
                if (typeof GM_setValue === 'function') GM_setValue('cnbClipboardIssue', clipIssue);
                // 即时生效：根据是否有值来动态增删"剪贴板"按钮
                const dock = document.querySelector('.cnb-dock');
                if (dock) {
                    let btn = dock.querySelector('#cnb-btn-clipboard');
                    if (clipIssue) {
                        if (!btn) {
                            const btnClipboard = document.createElement('button');
                            btnClipboard.id = 'cnb-btn-clipboard';
                            btnClipboard.className = 'cnb-dock-btn';
                            btnClipboard.textContent = '剪贴板';
                            btnClipboard.addEventListener('click', (e) => {
                                e.preventDefault();
                                if (typeof openClipboardWindow === 'function') {
                                    openClipboardWindow();
                                }
                            });
                            dock.appendChild(btnClipboard);
                        }
                    } else {
                        if (btn) btn.remove();
                    }
                }
            };
            clipIssueInput.addEventListener('input', updateClipIssue);
        }

        if (hotkeyEnabledInput) {
            hotkeyEnabledInput.addEventListener('change', () => {
                HOTKEY_ENABLED = !!hotkeyEnabledInput.checked;
                if (typeof GM_setValue === 'function') GM_setValue('cnbHotkeyEnabled', HOTKEY_ENABLED);
            });
        }
        // 录制快捷键：在输入框中按组合键即生成规范字符串
        if (hotkeyInput) {
            hotkeyInput.addEventListener('keydown', (e) => {
                e.preventDefault();
                const str = eventToHotkeyString(e);
                hotkeyInput.value = toDisplayHotkeyString(normalizeHotkeyString(str));
                // 快捷键即时保存
                START_HOTKEY = normalizeHotkeyString(str);
                if (typeof GM_setValue === 'function') GM_setValue('cnbHotkey', START_HOTKEY);
            });
        }
        // 回车键添加标签
        newTagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addTagBtn.click();
            }
        });

        function renderTagsList() {
            tagsList.innerHTML = '';
            const tags = Array.isArray(SAVED_TAGS) ? SAVED_TAGS : [];
            if (tags.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'cnb-hint';
                empty.textContent = '暂无标签';
                tagsList.appendChild(empty);
                return;
            }
            tags.forEach((tag, idx) => {
                const item = document.createElement('span');
                item.textContent = tag;
                item.className = 'cnb-tag-pill';

                const del = document.createElement('button');
                del.type = 'button';
                del.textContent = '×';
                del.title = '删除';
                del.className = 'cnb-tag-delbtn';
                del.addEventListener('click', async () => {
                    const repo = dialog.querySelector('#cnb-setting-repo').value.trim();
                    const token = dialog.querySelector('#cnb-setting-token').value.trim();

                    // 如果配置了仓库路径和访问令牌，则调用 API 删除标签
                    if (repo && token) {
                        const deleteLabelUrl = `${CONFIG.apiBase}/${repo}/-/labels/${encodeURIComponent(tag)}`;

                        try {
                            await new Promise((resolve, reject) => {
                                GM_xmlhttpRequest({
                                    method: 'DELETE',
                                    url: deleteLabelUrl,
                                    headers: {
                                        'Accept': 'application/vnd.cnb.api+json',
                                        'Authorization': token
                                    },
                                    onload: function(response) {
                                        if (response.status >= 200 && response.status < 300) {
                                            resolve();
                                        } else {
                                            reject(new Error(`HTTP ${response.status}`));
                                        }
                                    },
                                    onerror: function() {
                                        reject(new Error('网络错误'));
                                    }
                                });
                            });
                        } catch (error) {
                            // API 删除失败，只从本地删除
                            console.warn('从仓库删除标签失败:', error);
                        }
                    }

                    // 从本地删除
                    SAVED_TAGS.splice(idx, 1);
                    if (typeof GM_setValue === 'function') GM_setValue('cnbTags', SAVED_TAGS);
                    renderTagsList();
                });

                item.appendChild(del);
                tagsList.appendChild(item);
            });
        }

        renderTagsList();

        addTagBtn.addEventListener('click', async () => {
            const t = (newTagInput.value || '').trim();
            if (!t) return;

            const repo = dialog.querySelector('#cnb-setting-repo').value.trim();
            const token = dialog.querySelector('#cnb-setting-token').value.trim();

            if (!repo || !token) {
                if (typeof GM_notification === 'function') {
                    GM_notification({ text: '请先配置仓库路径和访问令牌', title: 'CNB Issue工具', timeout: 3000 });
                }
                return;
            }

            // 创建仓库标签
            const createLabelUrl = `${CONFIG.apiBase}/${repo}/-/labels`;

            try {
                await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: createLabelUrl,
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/vnd.cnb.api+json',
                            'Authorization': token
                        },
                        data: JSON.stringify({ name: t }),
                        responseType: 'json',
                        onload: function(response) {
                            if (response.status >= 200 && response.status < 300) {
                                resolve();
                            } else {
                                let errorMsg = `HTTP ${response.status}`;
                                try {
                                    const err = typeof response.response === 'string'
                                        ? JSON.parse(response.response) : response.response;
                                    if (err?.message) errorMsg = err.message;
                                } catch (e) {}
                                reject(new Error(errorMsg));
                            }
                        },
                        onerror: function() {
                            reject(new Error('网络错误'));
                        }
                    });
                });

                // 添加到本地列表
                if (!Array.isArray(SAVED_TAGS)) SAVED_TAGS = [];
                if (!SAVED_TAGS.includes(t)) {
                    SAVED_TAGS.push(t);
                    if (typeof GM_setValue === 'function') GM_setValue('cnbTags', SAVED_TAGS);
                    renderTagsList();
                    newTagInput.value = '';
                    if (typeof GM_notification === 'function') {
                        GM_notification({ text: '标签已添加', title: 'CNB Issue工具', timeout: 1500 });
                    }
                }
            } catch (error) {
                if (typeof GM_notification === 'function') {
                    GM_notification({ text: `添加标签失败: ${error.message}`, title: 'CNB Issue工具', timeout: 3000 });
                }
            }
        });

        // 自动获取标签（打开设置对话框时自动调用）
        async function fetchRepoTags(repo, token) {
            if (!repo || !token) {
                return;
            }

            // 分页获取所有标签
            let allLabels = [];
            let page = 1;
            const pageSize = 50;
            let hasMore = true;

            async function fetchLabelsPage() {
                return new Promise((resolve, reject) => {
                    const labelsUrl = `${CONFIG.apiBase}/${repo}/-/labels?page=${page}&page_size=${pageSize}`;
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: labelsUrl,
                        headers: {
                            'Accept': 'application/vnd.cnb.api+json',
                            'Authorization': token
                        },
                        responseType: 'json',
                        onload: function(response) {
                            if (response.status === 200) {
                                let data = null;
                                try {
                                    data = typeof response.response === 'object' && response.response !== null
                                        ? response.response
                                        : JSON.parse(response.responseText || '{}');
                                } catch (e) {
                                    data = null;
                                }

                                const labels = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
                                allLabels = allLabels.concat(labels);

                                // 检查是否还有更多数据
                                const total = data?.total_count ?? data?.total ?? data?.totalCount ?? 0;
                                hasMore = labels.length === pageSize && allLabels.length < total;
                                resolve(labels);
                            } else {
                                let errorMsg = `HTTP ${response.status}`;
                                try {
                                    const err = typeof response.response === 'string'
                                        ? JSON.parse(response.response) : response.response;
                                    if (err?.message) errorMsg = err.message;
                                } catch (e) {}
                                reject(new Error(errorMsg));
                            }
                        },
                        onerror: function() {
                            reject(new Error('网络错误'));
                        }
                    });
                });
            }

            try {
                while (hasMore) {
                    await fetchLabelsPage();
                    page++;
                }

                const labelNames = allLabels.map(l => l.name || l.title || l).filter(Boolean);

                // 直接替换标签列表
                SAVED_TAGS = labelNames;
                if (typeof GM_setValue === 'function') GM_setValue('cnbTags', SAVED_TAGS);
                renderTagsList();

                if (labelNames.length > 0) {
                    if (typeof GM_notification === 'function') {
                        GM_notification({ text: `已获取 ${labelNames.length} 个标签`, title: 'CNB Issue工具', timeout: 2000 });
                    }
                } else {
                    if (typeof GM_notification === 'function') {
                        GM_notification({ text: '仓库暂无标签', title: 'CNB Issue工具', timeout: 2000 });
                    }
                }
            } catch (error) {
                // 静默失败，不影响对话框打开
                console.warn('获取标签失败:', error);
            }
        }

        // 打开对话框时自动获取标签
        const repo = dialog.querySelector('#cnb-setting-repo').value.trim();
        const token = dialog.querySelector('#cnb-setting-token').value.trim();
        fetchRepoTags(repo, token);


        const close = () => {
            if (document.body.contains(overlay)) document.body.removeChild(overlay);
            if (document.body.contains(dialog)) document.body.removeChild(dialog);
            __CNB_SETTINGS_OVERLAY = null;
            __CNB_SETTINGS_DIALOG = null;
        };

        const closeBtn = dialog.querySelector('.cnb-dialog-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', close);
        }
        overlay.addEventListener('click', close);

        // ESC 关闭
        const onSettingsEsc = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
                document.removeEventListener('keydown', onSettingsEsc, true);
            }
        };
        document.addEventListener('keydown', onSettingsEsc, true);

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);

        console.log('[CNB Issue] overlay added:', document.body.contains(overlay));
        console.log('[CNB Issue] dialog added:', document.body.contains(dialog));
        console.log('[CNB Issue] dialog.className:', dialog.className);
    }

    // Issue 列表弹窗
    function openIssueList() {
        // 单例：若已存在，先移除旧实例
        try {
            if (__CNB_ISSUE_OVERLAY && __CNB_ISSUE_OVERLAY.parentNode) __CNB_ISSUE_OVERLAY.remove();
            if (__CNB_ISSUE_DIALOG && __CNB_ISSUE_DIALOG.parentNode) __CNB_ISSUE_DIALOG.remove();
        } catch (_) {}
        if (!CONFIG.repoPath || !CONFIG.accessToken) {
            if (typeof GM_notification === 'function') {
                GM_notification({ text: '请先在设置中配置仓库路径与访问令牌', title: 'CNB Issue工具', timeout: 3000 });
            }
            if (typeof openSettingsDialog === 'function') openSettingsDialog();
            return;
        }

        // 如果已存在旧窗口，先清理
        try { if (__CNB_CLIP_DIALOG) __CNB_CLIP_DIALOG.remove(); } catch (_) {}
        // 移除所有旧的标签容器
        try {
            const oldTabsList = document.querySelectorAll('.cnb-clipwin-tabs');
            oldTabsList.forEach(tab => tab.remove());
        } catch (_) {}
        __CNB_CLIP_DIALOG = null;

        const overlay = document.createElement('div');
        overlay.className = 'cnb-issue-overlay';
        __CNB_ISSUE_OVERLAY = overlay;

        const dialog = document.createElement('div');
        dialog.className = 'cnb-issue-dialog';
        __CNB_ISSUE_DIALOG = dialog;

        dialog.innerHTML = `
            <button class="cnb-dialog-close" title="关闭" style="position:absolute; right:10px; top:10px; border:none; background:transparent; color:#000; font-size:20px; line-height:1; cursor:pointer; font-weight:700;">×</button>
            <h3>Issue 列表</h3>
            <div id="cnb-issue-filter" class="cnb-issue-filter" style="margin:6px 0;"></div>
            <div id="cnb-issue-list" style="height:55vh; overflow:auto; border:2px solid #000; border-radius:0;"></div>
            <div id="cnb-issue-pagination" style="margin-top:10px;display:flex;justify-content:center;gap:10px;"></div>
        `;

        // 固定对话框尺寸，防止点击筛选按钮时窗口抖动
        dialog.style.width = '840px';
        dialog.style.maxWidth = '840px';

        // 补充：筛选按钮按压态样式 - 扁平黑白配色
        GM_addStyle(`
            .cnb-issue-filter-btn.pressed {
                transform: translate(1px, 1px);
                box-shadow: none;
            }
            .cnb-issue-filter-btn {
                transition: all 0.1s ease;
            }
        `);

        const listEl = dialog.querySelector('#cnb-issue-list');
        const closeBtn = dialog.querySelector('.cnb-dialog-close');

        // 行内标签（Issue 列表中的 labels）胶囊样式 - 扁平黑白配色
        GM_addStyle(`
            .cnb-issue-chip {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 3px 8px;
                border: 2px solid #000;
                border-radius: 0;
                background: #fff;
                color: #000;
                font-size: 11px;
                font-weight: 500;
                line-height: 1.1;
                white-space: nowrap;
                vertical-align: middle;
                box-shadow: none;
                transition: all 0.1s ease;
                user-select: none;
            }
            .cnb-issue-chip:hover {
                background: #000;
                color: #fff;
            }
        `);
        const close = () => {
            if (document.body.contains(overlay)) document.body.removeChild(overlay);
            if (document.body.contains(dialog)) document.body.removeChild(dialog);
            document.removeEventListener('keydown', onEsc, true);
            __CNB_ISSUE_OVERLAY = null;
            __CNB_ISSUE_DIALOG = null;
        };
        overlay.addEventListener('click', close);
        if (closeBtn) closeBtn.addEventListener('click', close);

        // ESC 关闭
        const onEsc = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        };
        document.addEventListener('keydown', onEsc, true);

        // 初始加载中
        listEl.innerHTML = `<div style="padding:12px;color:#000;font-weight:600;">加载中...</div>`;

        // 分页相关变量
        let currentPage = 1;
        const pageSize = 50;
        let allItems = [];
        let currentFilterLabel = null;

        function loadIssues(page) {
            listEl.innerHTML = `<div style="padding:12px;color:#000;font-weight:600;">加载中...</div>`;

            const url = `${CONFIG.apiBase}/${CONFIG.repoPath}${CONFIG.issueEndpoint}?page=${page}&page_size=${pageSize}&state=closed`;
            GM_xmlhttpRequest({
                method: 'GET',
                url: url.replace(/&/g, '&'),
                headers: {
                    'accept': 'application/json',
                    'Authorization': `${CONFIG.accessToken}`
                },
                responseType: 'json',
                onload: function(res) {
                    try {
                        const data = typeof res.response === 'object' && res.response !== null
                            ? res.response
                            : JSON.parse(res.responseText || '[]');
                        const items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);

                        if (!items.length) {
                            listEl.innerHTML = `<div style="padding:12px;color:#000;font-weight:600;">暂无数据</div>`;
                            return;
                        }

                        allItems = Array.isArray(items) ? items : [];

                        // 根据返回的数量判断是否有下一页
                        // 如果返回的数量等于 pageSize，说明可能还有下一页
                        // 否则就是最后一页
                        const hasMore = items.length === pageSize;

                        currentPage = page;
                        renderList(currentFilterLabel);
                        renderPagination(hasMore);
                    } catch (e) {
                        listEl.innerHTML = `<div style="padding:12px;color:#000;font-weight:600;">加载失败</div>`;
                    }
                },
                onerror: function() {
                    listEl.innerHTML = `<div style="padding:12px;color:#000;font-weight:600;">网络请求失败</div>`;
                }
            });
        }

        function renderList(filterLabel) {
            const filterEl = dialog.querySelector('#cnb-issue-filter');
            // 行内样式强制为 flex 并设置 4px 间距，避免被站点覆盖
            if (filterEl) {
                const s = filterEl.style;
                s.setProperty('display', 'flex', 'important');
                s.setProperty('flex-wrap', 'wrap', 'important');
                s.setProperty('gap', '4px', 'important');
            }

            const frag = document.createDocumentFragment();
            const filtered = !filterLabel ? allItems : allItems.filter(it => {
                const names = Array.isArray(it.labels) ? it.labels.map(l => l.name) : [];
                return names.includes(filterLabel);
            });

            filtered.forEach(it => {
                const number = it.number ?? it.id ?? it.iid ?? '';
                const title = it.title ?? '';
                const createdAt = it.created_at ?? '';
                const labelNames = Array.isArray(it.labels) ? it.labels.map(l => l.name) : [];

                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:2px solid #000;';

                const left = document.createElement('div');
                left.style.cssText = 'min-width:0;flex:1;font-size:13px;color:#000;display:flex;gap:6px !important;align-items:center;';

                const prefix = document.createElement('span');
                prefix.textContent = `#${number}`;
                prefix.style.fontWeight = '700';

                const a = document.createElement('a');
                a.href = `https://cnb.cool/${CONFIG.repoPath}/-/issues/${number}`;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                const fullTitle = String(title || '');
                const truncated = fullTitle.length > 40 ? fullTitle.slice(0, 40) + '…' : fullTitle;
                a.textContent = truncated;
                a.title = fullTitle;
                a.style.cssText = 'color:#000;text-decoration:none;word-break:break-all;font-weight:500;';
                a.addEventListener('mouseover', () => a.style.textDecoration = 'underline');
                a.addEventListener('mouseout', () => a.style.textDecoration = 'none');

                left.appendChild(prefix);
                left.appendChild(a);

                // 复制按钮：关闭 Issue(完成) 并复制 title + body(清理为Markdown) 到剪贴板
                const btnCopy = document.createElement('button');
                btnCopy.type = 'button';
                btnCopy.textContent = '📋';
                btnCopy.title = '复制到剪贴板';
                btnCopy.style.cssText = 'margin-left:6px;display:inline-flex;align-items:center;justify-content:center;padding:3px 6px;border:2px solid #000;background:#fff;color:#000;font-size:11px;font-weight:600;cursor:pointer;line-height:1;transition:all 0.1s ease;';
                btnCopy.addEventListener('mouseover', () => { btnCopy.style.background = '#000'; btnCopy.style.color = '#fff'; });
                btnCopy.addEventListener('mouseout', () => { btnCopy.style.background = '#fff'; btnCopy.style.color = '#000'; });
                btnCopy.addEventListener('click', () => {
                    if (btnCopy.disabled) return;
                    btnCopy.disabled = true;
                    const oldText = btnCopy.textContent;
                    btnCopy.textContent = '…';
                    const urlPatch = `${CONFIG.apiBase}/${CONFIG.repoPath}${CONFIG.issueEndpoint}/${number}`;
                    GM_xmlhttpRequest({
                        method: 'PATCH',
                        url: urlPatch,
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `${CONFIG.accessToken}`,
                            'Accept': 'application/json'
                        },
                        data: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
                        responseType: 'json',
                        onload: function(res) {
                            try {
                                if (res.status >= 200 && res.status < 300) {
                                    let obj = null;
                                    try {
                                        obj = (typeof res.response === 'object' && res.response !== null)
                                            ? res.response
                                            : JSON.parse(res.responseText || '{}');
                                    } catch(_) {}
                                    const t = (obj && obj.title) ? obj.title : title;
                                    const b = (obj && typeof obj.body === 'string') ? obj.body : '';
                                    const md = cleanMarkdownContent(String(b || ''));
                                    if (typeof GM_setClipboard === 'function') {
                                        GM_setClipboard(`${t}

${md}`, 'text');
                                    }
                                    if (typeof GM_notification === 'function') {
                                        GM_notification({ text: '已关闭并复制到剪贴板', title: 'CNB Issue工具', timeout: 3000 });
                                    }
                                } else {
                                    if (typeof GM_notification === 'function') {
                                        GM_notification({ text: '操作失败: HTTP ' + res.status, title: 'CNB Issue工具', timeout: 5000 });
                                    }
                                }
                            } finally {
                                btnCopy.disabled = false;
                                btnCopy.textContent = oldText;
                            }
                        },
                        onerror: function() {
                            if (typeof GM_notification === 'function') {
                                GM_notification({ text: '网络请求失败', title: 'CNB Issue工具', timeout: 5000 });
                            }
                            btnCopy.disabled = false;
                            btnCopy.textContent = oldText;
                        }
                    });
                });
                left.appendChild(btnCopy);

                const right = document.createElement('div');
                right.style.cssText = 'flex:0 0 auto;color:#57606a;font-size:11px;text-align:right;display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;';

                // 标签胶囊容器
                const labelsWrap = document.createElement('div');
                labelsWrap.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;';

                const labelObjs = Array.isArray(it.labels) ? it.labels : [];
                labelObjs.forEach(l => {
                    const chip = document.createElement('span');
                    chip.className = 'cnb-issue-chip';
                    chip.textContent = l?.name ?? '';
                    // 若有颜色，应用为背景，并适当设置边框与前景色
                    const color = (l && typeof l.color === 'string' && l.color) ? l.color : '';
                    if (color) {
                        chip.style.background = color;
                        // 根据背景亮度调整文字与边框（简单阈值）
                        try {
                            const hex = color.replace('#','');
                            const r = parseInt(hex.substring(0,2),16);
                            const g = parseInt(hex.substring(2,4),16);
                            const b = parseInt(hex.substring(4,6),16);
                            const lum = 0.2126*r + 0.7152*g + 0.0722*b;
                            chip.style.color = lum < 140 ? '#fff' : '#24292f';
                            chip.style.borderColor = lum < 140 ? 'rgba(255,255,255,0.35)' : '#d0d7de';
                        } catch(_) {}
                    }
                    labelsWrap.appendChild(chip);
                });

                const dateSpan = document.createElement('span');
                dateSpan.textContent = createdAt;
                dateSpan.style.cssText = 'color:#57606a;';

                right.appendChild(labelsWrap);
                right.appendChild(dateSpan);

                row.appendChild(left);
                row.appendChild(right);
                frag.appendChild(row);
            });

            listEl.innerHTML = '';
            listEl.appendChild(frag);
        }

        function renderPagination(hasMore) {
            const paginationEl = dialog.querySelector('#cnb-issue-pagination');
            if (!paginationEl) return;

            paginationEl.innerHTML = '';

            // 第一页不显示"上一页"按钮
            if (currentPage > 1) {
                const prevBtn = document.createElement('button');
                prevBtn.textContent = '上一页';
                prevBtn.style.cssText = 'padding:4px 8px;font-size:12px;border:2px solid #000;background:#fff;color:#000;font-weight:600;cursor:pointer;';
                prevBtn.addEventListener('click', () => {
                    if (currentPage > 1) {
                        currentPage--;
                        loadIssues(currentPage);
                    }
                });
                paginationEl.appendChild(prevBtn);
            }

            // 最后一页不显示"下一页"按钮
            if (hasMore) {
                const nextBtn = document.createElement('button');
                nextBtn.textContent = '下一页';
                nextBtn.style.cssText = 'padding:4px 8px;font-size:12px;border:2px solid #000;background:#fff;color:#000;font-weight:600;cursor:pointer;';
                nextBtn.addEventListener('click', () => {
                    currentPage++;
                    loadIssues(currentPage);
                });
                paginationEl.appendChild(nextBtn);
            }
        }

        // 渲染筛选按钮
        const filterEl = dialog.querySelector('#cnb-issue-filter');
        if (filterEl) {
            filterEl.innerHTML = '';
            const allBtn = document.createElement('button');
            allBtn.className = 'cnb-issue-filter-btn active';
            allBtn.textContent = '全部';
            applyFilterButtonStyles(allBtn);
            applyFilterButtonActive(allBtn);
            addPressEffect(allBtn);
            allBtn.addEventListener('click', () => {
                setActive(allBtn);
                currentFilterLabel = null;
                renderList(null);
            });
            filterEl.appendChild(allBtn);

            const tagList = Array.isArray(SAVED_TAGS) ? SAVED_TAGS : [];
            tagList.forEach(tag => {
                const b = document.createElement('button');
                b.className = 'cnb-issue-filter-btn';
                b.textContent = tag;
                applyFilterButtonStyles(b);
                addPressEffect(b);
                b.addEventListener('click', () => {
                    setActive(b);
                    currentFilterLabel = tag;
                    renderList(tag);
                });
                filterEl.appendChild(b);
            });

            function setActive(btn) {
                const buttons = filterEl.querySelectorAll('button');
                buttons.forEach(x => {
                    x.classList.remove('active');
                    applyFilterButtonDefault(x);
                });
                btn.classList.add('active');
                applyFilterButtonActive(btn);
            }

            // 行内样式（带 !important）确保胶囊风格不被站点覆盖
            function applyFilterButtonStyles(btn) {
                const s = btn.style;
                s.setProperty('display', 'inline-flex', 'important');
                s.setProperty('align-items', 'center', 'important');
                s.setProperty('gap', '6px', 'important');
                s.setProperty('padding', '4px 10px', 'important');
                s.setProperty('border', '1px solid #d0d7de', 'important');
                s.setProperty('border-radius', '9999px', 'important');
                s.setProperty('background', '#fff', 'important');
                s.setProperty('color', '#24292f', 'important');
                s.setProperty('font-size', '13px', 'important');
                s.setProperty('line-height', '1.2', 'important');
                s.setProperty('white-space', 'nowrap', 'important');
                s.setProperty('vertical-align', 'middle', 'important');
                s.setProperty('box-shadow', '0 1px 0 rgba(27,31,36,0.04)', 'important');
                s.setProperty('transition', 'background-color .15s ease, border-color .15s ease, box-shadow .15s ease, transform .02s ease', 'important');
                s.setProperty('cursor', 'pointer', 'important');
                s.setProperty('user-select', 'none', 'important');
                // 关键：移除按钮自身外边距，确保由容器 gap 控制间距
                s.setProperty('margin', '0', 'important');
            }
            function applyFilterButtonDefault(btn) {
                const s = btn.style;
                s.setProperty('background', '#fff', 'important');
                s.setProperty('border-color', '#d0d7de', 'important');
                s.setProperty('color', '#24292f', 'important');
                s.setProperty('box-shadow', '0 1px 0 rgba(27,31,36,0.04)', 'important');
            }
            function applyFilterButtonActive(btn) {
                const s = btn.style;
                s.setProperty('background', '#0366d6', 'important');
                s.setProperty('border-color', '#0256b9', 'important');
                s.setProperty('color', '#fff', 'important');
                s.setProperty('box-shadow', '0 1px 0 rgba(27,31,36,0.05)', 'important');
            }

            // 为筛选按钮添加按压反馈
            function addPressEffect(btn) {
                btn.addEventListener('mousedown', () => btn.classList.add('pressed'));
                btn.addEventListener('mouseup', () => btn.classList.remove('pressed'));
                btn.addEventListener('mouseleave', () => btn.classList.remove('pressed'));
                btn.addEventListener('touchstart', () => btn.classList.add('pressed'), { passive: true });
                btn.addEventListener('touchend', () => btn.classList.remove('pressed'));
                btn.addEventListener('touchcancel', () => btn.classList.remove('pressed'));
                btn.addEventListener('blur', () => btn.classList.remove('pressed'));
            }
        }

        // 首次加载第一页
        loadIssues(1);

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);

        console.log('[CNB Issue] overlay added:', document.body.contains(overlay));
        console.log('[CNB Issue] dialog added:', document.body.contains(dialog));
        console.log('[CNB Issue] dialog.className:', dialog.className);
    }

    // 剪贴板弹窗（独立样式），展示 Issue #25
    function openClipboardWindow() {
        // 单例：若已存在旧窗口或标签，先移除
        try { if (__CNB_CLIP_DIALOG && __CNB_CLIP_DIALOG.parentNode) __CNB_CLIP_DIALOG.remove(); } catch (_) {}
        try {
            const existingTabs = document.getElementById('cnb-clipwin-tabs');
            if (existingTabs) existingTabs.remove();
        } catch (_) {}
        __CNB_CLIP_DIALOG = null;
        try {
            // 注入独立样式（不复用 .cnb-issue-dialog），无遮罩，默认居中，可拖动
            addStyleOnce('clipwin-base', `
                .cnb-clipwin {
                    position: fixed;
                    left: 50%; top: 50%;
                    transform: translate(-50%, -50%);
                    width: min(320px, 92vw);
                    max-height: 80vh;
                    display: flex; flex-direction: column;
                    background: #ffffff;
                    border: 2px solid #000;
                    border-radius: 0;
                    box-shadow: 4px 4px 0 #000;
                    z-index: 10010;
                    overflow: hidden;
                    font: 13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Helvetica,Arial,"PingFang SC","Microsoft Yahei",sans-serif;
                    color: #000;
                }
                .cnb-clipwin-header {
                    position: relative;
                    height: 28px;
                    border-bottom: 2px solid #000;
                    background: #000;
                    cursor: move; /* 拖动条 */
                }
                .cnb-clipwin-close {
                    position: absolute;
                    right: 6px; top: 3px;
                    border: none; background: transparent;
                    color: #fff; font-size: 18px; line-height: 1;
                    cursor: pointer;
                    padding: 0 4px;
                }
                .cnb-clipwin-pin {
                    position: absolute;
                    right: 30px; top: 5px;
                    border: none; background: transparent;
                    color: #fff; line-height: 1;
                    cursor: pointer;
                    padding: 2px;
                }
                /* 左上角标题 */
                .cnb-clipwin-title {
                    position: absolute;
                    left: 6px; top: 6px;
                    border: none; background: transparent;
                    color: #fff; line-height: 1; font-size: 11px; font-weight: 600;
                    pointer-events: auto;
                }
                .cnb-clipwin-title a {
                    color: #fff;
                    text-decoration: none;
                }
                .cnb-clipwin-title a:hover {
                    text-decoration: underline;
                }
                    text-transform: uppercase;
                }
                .cnb-clipwin-close:hover, .cnb-clipwin-pin:hover { color: #ccc; }
                /* 固定按钮图标样式 */
                .cnb-clipwin-pin svg {
                    fill: rgba(255, 255, 255, 0.5);
                    transition: fill 0.15s ease;
                }
                .cnb-clipwin-pin:hover svg {
                    fill: rgba(255, 255, 255, 0.8);
                }
                .menuBar-Btn_Icon-pin.isActive {
                    fill: #2ea043 !important;
                }
                .cnb-clipwin-content {
                    padding: 8px;
                    overflow: auto;
                }
                .cnb-clipwin-tabs {
                    position: fixed;
                    left: 50%;
                    top: 50%;
                    display: flex;
                    flex-direction: column;
                    z-index: 10011;
                }
                .cnb-clipwin-tab {
                    margin: 2px 0;
                    padding: 5px 12px;
                    padding-left: 12px;
                    background: #f5f5f5;
                    border: 2px solid #000;
                    border-right: none;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 500;
                    color: #000;
                    text-align: left;
                    min-width: 60px;
                }
                .cnb-clipwin-tab:hover {
                    background: #e0e0e0;
                }
                .cnb-clipwin-tab.active {
                    background: #fff;
                    color: #000;
                    font-weight: 600;
                }
                .cnb-clipwin-tab.active::after {
                    content: '';
                    display: block;
                    margin-right: -1px;
                    height: 100%;
                    width: 1px;
                    background: #fff;
                }
                .cnb-clipwin-body {
                    margin: 0;
                    padding: 8px;
                    background: #fff;
                    border: 2px solid #000;
                    border-radius: 0;
                    white-space: pre-wrap;
                    word-break: break-word;
                    font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
                    font-size: 11px;
                    line-height: 1.4;
                    max-height: 60vh;
                    overflow: auto;
                }
                .cnb-clipwin-actions {
                    border-top: 2px solid #000;
                    padding: 8px 12px;
                    display: flex; gap: 6px; justify-content: flex-end;
                    background: #fff;
                }
                .cnb-clipwin-btn {
                    display: inline-flex; align-items: center; justify-content: center;
                    height: 28px; padding: 0 12px; border-radius: 0;
                    border: 2px solid #000; background: #fff; color: #000;
                    font-size: 12px; font-weight: 600;
                    cursor: pointer; transition: all 0.1s ease;
                    box-shadow: 2px 2px 0 #000;
                }
                .cnb-clipwin-btn:hover { background: #000; color: #fff; }
                .cnb-clipwin-btn:active { transform: translate(2px, 2px); box-shadow: none; }
            `);
        } catch (_) {}

        // 覆盖剪贴板窗口内容样式，适配 HTML 渲染 - 扁平黑白配色
        try {
            addStyleOnce('clipwin-body', `
                .cnb-clipwin-body {
                    margin: 0;
                    padding: 8px;
                    background: #ffffff;
                    border: 2px solid #000;
                    border-radius: 0;
                    word-break: break-word;
                    font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Helvetica,Arial,"PingFang SC","Microsoft Yahei",sans-serif;
                    font-size: 12px;
                    line-height: 1.4;
                    color: #000;
                    max-height: 65vh;
                    overflow: auto;
                }
                .cnb-clipwin-body * {
                    margin-top: 0 !important;
                    margin-bottom: 0 !important;
                }
                .cnb-clipwin-body h1 { font-size: 1.5em; margin: .3em 0 .2em 0 !important; font-weight: 700; color: #000; }
                .cnb-clipwin-body h2 { font-size: 1.3em; margin: .3em 0 .2em 0 !important; font-weight: 700; color: #000; }
                .cnb-clipwin-body h3 { font-size: 1.15em; margin: .3em 0 .2em 0 !important; font-weight: 700; color: #000; }
                .cnb-clipwin-body p  { margin: .2em 0 !important; color: #000; }
                .cnb-clipwin-body ul, .cnb-clipwin-body ol { padding-left: 1.3em; margin: .2em 0 !important; color: #000; }
                .cnb-clipwin-body blockquote {
                    margin: .2em 0 !important; padding: .3em .6em; color:#000; background:#f5f5f5; border-left: 3px solid #000; border-radius: 0;
                }
                .cnb-clipwin-body hr { border: none; border-top: 2px solid #000; margin: .3em 0 !important; }
                .cnb-clipwin-body code {
                    background: #000; border: none; border-radius: 0; padding: .08em .3em; font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace; font-size: .88em; color: #fff;
                }
                .cnb-clipwin-body pre {
                    background: #000; color: #fff; border-radius: 0; padding: 8px; margin: .2em 0 .3em 0 !important; overflow-x: hidden; overflow-y: auto;
                }
                .cnb-clipwin-body pre code { background: transparent; border: none; padding: 0; color: inherit; font-size: .92em; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; }
                .cnb-clipwin-body a { color: #000; text-decoration: underline; font-weight: 500; }
                .cnb-clipwin-body a:hover { text-decoration: underline; color: #666; }
            `);
        } catch (_) {}
        /* 剪贴板窗口滚动条样式：扁平黑白（仅作用于剪贴板窗口） */
        try {
            GM_addStyle(`
                /* Firefox */
                .cnb-clipwin, .cnb-clipwin-content, .cnb-clipwin-body, .cnb-clipwin-body pre {
                    scrollbar-width: thin;
                    scrollbar-color: #000 #f5f5f5;
                }
                /* WebKit */
                .cnb-clipwin::-webkit-scrollbar,
                .cnb-clipwin-content::-webkit-scrollbar,
                .cnb-clipwin-body::-webkit-scrollbar,
                .cnb-clipwin-body pre::-webkit-scrollbar {
                    width: 8px;
                    height: 8px;
                }
                .cnb-clipwin::-webkit-scrollbar-track,
                .cnb-clipwin-content::-webkit-scrollbar-track,
                .cnb-clipwin-body::-webkit-scrollbar-track,
                .cnb-clipwin-body pre::-webkit-scrollbar-track {
                    background: #f5f5f5;
                }
                .cnb-clipwin::-webkit-scrollbar-thumb,
                .cnb-clipwin-content::-webkit-scrollbar-thumb,
                .cnb-clipwin-body::-webkit-scrollbar-thumb,
                .cnb-clipwin-body pre::-webkit-scrollbar-thumb {
                    background: #000;
                    border-radius: 0;
                }
                .cnb-clipwin::-webkit-scrollbar-thumb:hover,
                .cnb-clipwin-content::-webkit-scrollbar-thumb:hover,
                .cnb-clipwin-body::-webkit-scrollbar-thumb:hover,
                .cnb-clipwin-body pre::-webkit-scrollbar-thumb:hover {
                    background: #333;
                }
            `);
        } catch (_) {}

        if (!CONFIG.repoPath || !CONFIG.accessToken) {
            if (typeof GM_notification === 'function') {
                GM_notification({ text: '请先在设置中配置仓库路径与访问令牌', title: 'CNB Issue工具', timeout: 3000 });
            }
            if (typeof openSettingsDialog === 'function') openSettingsDialog();
            return;
        }

        // 如果已存在旧窗口，先清理
        try { if (__CNB_CLIP_DIALOG) __CNB_CLIP_DIALOG.remove(); } catch (_) {}
        // 移除所有旧的标签容器
        try {
            const oldTabsList = document.querySelectorAll('.cnb-clipwin-tabs');
            oldTabsList.forEach(tab => tab.remove());
        } catch (_) {}
        __CNB_CLIP_DIALOG = null;

        // 仅创建窗口（无遮罩）
        const dialog = document.createElement('div');
        dialog.className = 'cnb-clipwin';
        __CNB_CLIP_DIALOG = dialog;
        dialog.innerHTML = `
            <div class="cnb-clipwin-header">
                <div class="cnb-clipwin-title">剪贴板</div>
                <button class="cnb-clipwin-pin" title="固定/取消固定">
                    <svg class="menuBar-Btn_Icon" width="15" height="15" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 53.011 53.011">
                        <path class="menuBar-Btn_Icon-pin" d="M52.963 21.297c-.068-.33-.297-.603-.61-.727-8.573-3.416-16.172-.665-18.36.288L19.113 8.2C19.634 3.632 17.17.508 17.06.372c-.18-.22-.442-.356-.725-.372-.282-.006-.56.09-.76.292L.32 15.546c-.202.2-.308.48-.29.765.015.285.152.55.375.727 2.775 2.202 6.35 2.167 7.726 2.055l12.722 14.953c-.868 2.23-3.52 10.27-.307 18.337.124.313.397.54.727.61.067.013.135.02.202.02.263 0 .518-.104.707-.293l14.57-14.57 13.57 13.57c.196.194.452.292.708.292s.512-.098.707-.293c.39-.392.39-1.024 0-1.415l-13.57-13.57 14.527-14.528c.237-.238.34-.58.27-.91zm-17.65 15.458L21.89 50.18c-2.437-8.005.993-15.827 1.03-15.91.158-.352.1-.764-.15-1.058L9.31 17.39c-.19-.225-.473-.352-.764-.352-.05 0-.103.004-.154.013-.036.007-3.173.473-5.794-.954l13.5-13.5c.604 1.156 1.39 3.26.964 5.848-.058。346。07。697。338。924l15.785 13.43c.31。262。748。31 1.105。128。077-.04 7.378-3.695 15.87-1.017L35.313 36.754z"></path>
                    </svg>
                </button>
                <button class="cnb-clipwin-close" title="关闭">×</button>
            </div>
            <div class="cnb-clipwin-content">
                <pre id="cnb-clipwin-body" class="cnb-clipwin-body">加载中…</pre>
            </div>

        `;

        // 读取存储的固定状态，默认为true（固定）
        let pinned = true;
        try {
            if (typeof GM_getValue === 'function') {
                const savedPinned = GM_getValue('cnbClipboardPinned', null);
                if (savedPinned !== null) {
                    pinned = Boolean(savedPinned);
                }
            }
        } catch (_) {}

        function cleanup() {
            document.removeEventListener('mousedown', onDocDown, true);
            document.removeEventListener('mouseup', onDocUp, true);
            document.removeEventListener('mousemove', onDocMove, true);
            document.removeEventListener('click', onOutsideClick, true);
            if (typeof onEsc === 'function') document.removeEventListener('keydown', onEsc, true);
        }
        function close() {
            cleanup();
            try { dialog.remove(); } catch (_) {}
            try { tabsContainer.remove(); } catch (_) {}
            try { if (__CNB_CLIP_DIALOG === dialog) __CNB_CLIP_DIALOG = null; } catch (_) {}
        }

        const btnPin = dialog.querySelector('.cnb-clipwin-pin');
        // 初始化按钮状态
        if (btnPin) {
            const path = btnPin.querySelector('.menuBar-Btn_Icon-pin');
            if (path) {
                if (pinned) path.classList.add('isActive');
                else path.classList.remove('isActive');
            }
            btnPin.addEventListener('click', () => {
                pinned = !pinned;
                if (path) {
                    if (pinned) path.classList.add('isActive');
                    else path.classList.remove('isActive');
                }
                // 保存固定状态
                try {
                    if (typeof GM_setValue === 'function') {
                        GM_setValue('cnbClipboardPinned', pinned);
                    }
                } catch (_) {}
            });
        }
        // 关闭按钮事件
        const btnClose = dialog.querySelector('.cnb-clipwin-close');
        if (btnClose) btnClose.addEventListener('click', close);

        // 复制按钮：复制窗口内容（优先原始 Markdown）
        const btnCopy = dialog.querySelector('.cnb-clipwin-copy');
        if (btnCopy) btnCopy.addEventListener('click', async () => {
            try {
                const body = dialog.querySelector('#cnb-clipwin-body');
                const rawText = (body && body.dataset && body.dataset.mdraw) ? body.dataset.mdraw : (body ? body.textContent : '');
                // 使用更激进的清理函数移除空行
                const text = typeof cleanMarkdownContentForCopy === 'function'
                    ? cleanMarkdownContentForCopy(String(rawText || ''))
                    : String(rawText || '');
                if (typeof GM_setClipboard === 'function') {
                    GM_setClipboard(String(text || ''), 'text');
                } else if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(String(text || ''));
                }
                if (typeof GM_notification === 'function') {
                    GM_notification({ text: '已复制到剪贴板', title: 'CNB 剪贴板', timeout: 2000 });
                }
            } catch (_) {}
        });

        // 点击窗口外关闭（未固定时）
        function onOutsideClick(e) {
            if (pinned) return;
            if (!dialog.contains(e.target) && !tabsContainer.contains(e.target)) close();
        }
        document.addEventListener('click', onOutsideClick, true);

        // ESC 关闭
        function onEsc(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        }
        document.addEventListener('keydown', onEsc, true);

        // 拖动逻辑（拖拽 header）
        const header = dialog.querySelector('.cnb-clipwin-header');
        let dragging = false;
        let startX = 0, startY = 0, boxX = 0, boxY = 0;

        function onDocDown(e) {
            if (header && header.contains(e.target)) {
                dragging = true;
                const rect = dialog.getBoundingClientRect();
                startX = e.clientX;
                startY = e.clientY;
                boxX = rect.left;
                boxY = rect.top;
                // 拖动时改为绝对定位并去掉居中 transform
                dialog.style.left = rect.left + 'px';
                dialog.style.top = rect.top + 'px';
                dialog.style.transform = 'none';
                // 标签在窗口左侧，需要减去标签的宽度，向下偏移 29px
                const tabWidth = tabsContainer.offsetWidth || 80;
                tabsContainer.style.left = (rect.left - tabWidth) + 'px';
                tabsContainer.style.top = (rect.top + 29) + 'px';
                tabsContainer.style.transform = 'none';
            }
        }
        function onDocUp() {
            if (dragging) {
                dragging = false;
                // 保存窗口位置
                try {
                    if (typeof GM_setValue === 'function') {
                        const rect = dialog.getBoundingClientRect();
                        GM_setValue('cnbClipboardWindowPos', JSON.stringify({
                            left: rect.left,
                            top: rect.top
                        }));
                    }
                } catch (_) {}
            }
        }
        function onDocMove(e) {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const tabWidth = tabsContainer.offsetWidth || 80;
            dialog.style.left = (boxX + dx) + 'px';
            dialog.style.top = (boxY + dy) + 'px';
            // 标签跟随窗口移动，在窗口左侧，向下偏移 29px
            tabsContainer.style.left = (boxX + dx - tabWidth) + 'px';
            tabsContainer.style.top = (boxY + dy + 29) + 'px';
        }
        document.addEventListener('mousedown', onDocDown, true);
        document.addEventListener('mouseup', onDocUp, true);
        document.addEventListener('mousemove', onDocMove, true);

        // 创建外部标签容器（在窗口左侧）
        // 先确保没有旧的标签容器
        const existingTabs = document.getElementById('cnb-clipwin-tabs');
        if (existingTabs) existingTabs.remove();

        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'cnb-clipwin-tabs';
        tabsContainer.id = 'cnb-clipwin-tabs';
        // 初始隐藏，等标签创建后再显示
        tabsContainer.style.display = 'none';
        // 将标签容器插入到 dialog 之前（作为兄弟元素）
        document.body.appendChild(tabsContainer);
        document.body.appendChild(dialog);

        const bodyEl = dialog.querySelector('#cnb-clipwin-body');
        const tabsEl = tabsContainer;

        // 读取剪贴板位置（Issue编号和窗口位置）
        let __clipIssueNum = '';
        let __clipWinPos = { left: null, top: null };
        try {
            if (typeof GM_getValue === 'function') {
                const v = GM_getValue('cnbClipboardIssue', '');
                __clipIssueNum = String(v || '').trim();
                const pos = GM_getValue('cnbClipboardWindowPos', '');
                if (pos) {
                    try {
                        __clipWinPos = JSON.parse(pos);
                    } catch (_) {}
                }
            }
        } catch (_) {}

        // 解析多个 Issue 编号（支持逗号分隔，如 "2,3,4"）
        const issueList = __clipIssueNum.split(/[,，]/).map(s => s.trim()).filter(s => s);
        const hasMultipleIssues = issueList.length > 1;

        // 显示标签栏（仅在多个 Issue 时）
        if (hasMultipleIssues) {
            tabsEl.style.display = 'flex';
        } else {
            tabsEl.style.display = 'none';
        }

        // 当前激活的 Issue 索引（默认第一个）
        let currentIssueIndex = 0;
        let issueDataCache = {}; // 缓存已加载的 Issue 数据

        // 函数：加载指定 Issue 的内容
        function loadIssue(issueNum, index) {
            const url = `${CONFIG.apiBase}/${CONFIG.repoPath}${CONFIG.issueEndpoint}/${encodeURIComponent(issueNum)}`;
            bodyEl.textContent = '加载中…';

            // 如果已缓存，直接使用
            if (issueDataCache[index]) {
                renderIssueContent(issueDataCache[index], issueNum);
                return;
            }

            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `${CONFIG.accessToken}`
                },
                responseType: 'json',
                onload: function(res) {
                    try {
                        if (res.status >= 200 && res.status < 300) {
                            let data = null;
                            try {
                                data = (typeof res.response === 'object' && res.response !== null)
                                    ? res.response
                                    : JSON.parse(res.responseText || '{}');
                            } catch (_) {}

                            // 缓存数据
                            issueDataCache[index] = data;
                            renderIssueContent(data, issueNum);
                        } else {
                            bodyEl.textContent = `加载失败 (HTTP ${res.status})`;
                        }
                    } catch (e) {
                        bodyEl.textContent = '加载出错';
                    }
                },
                onerror: function() {
                    bodyEl.textContent = '网络错误';
                }
            });
        }

        // 函数：渲染 Issue 内容
        function renderIssueContent(data, issueNum) {
            const rawBody = typeof data?.body === 'string' ? data.body : '';
            const md = typeof cleanMarkdownContent === 'function'
                ? cleanMarkdownContent(String(rawBody || ''))
                : String(rawBody || '');

            if (bodyEl) {
                bodyEl.dataset.mdraw = md;
                bodyEl.innerHTML = (typeof markdownToHtml === 'function') ? markdownToHtml(md) : md;
                // 移除所有 <br>，避免用换行标签作为分隔
                try { bodyEl.querySelectorAll('br').forEach(br => br.remove()); } catch (_) {}
            }

            // 设置标题文本和链接（优先 Issue 标题）
            const titleEl = dialog.querySelector('.cnb-clipwin-title');
            const t = (data && typeof data.title === 'string' && data.title) ? data.title : '剪贴板';

            // 保存 Issue 标题到本地
            try {
                if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
                    const titles = GM_getValue('cnbClipboardIssueTitles', '{}');
                    const titleMap = typeof titles === 'object' ? titles : {};
                    titleMap[String(issueNum)] = t;
                    GM_setValue('cnbClipboardIssueTitles', titleMap);
                }
            } catch (_) {}

            let issueUrl = '';
            if (data && data.web_url) {
                issueUrl = data.web_url;
            } else if (data && data.html_url) {
                issueUrl = data.html_url;
            } else if (data && data.iid) {
                // 如果 API 没有返回 URL，则手动构建
                issueUrl = `https://cnb.cool/${CONFIG.repoPath}/-/issues/${data.iid}`;
            } else if (issueNum) {
                issueUrl = `https://cnb.cool/${CONFIG.repoPath}/-/issues/${issueNum}`;
            }
            if (titleEl) {
                if (issueUrl) {
                    titleEl.innerHTML = `<a href="${issueUrl}" target="_blank" rel="noopener noreferrer" style="color:#fff;text-decoration:none;">${t}</a>`;
                } else {
                    titleEl.textContent = t;
                }
            }

            // 更新对应标签的标题
            // 通过 issueNum 找到对应的索引
            const tabIndex = issueList.indexOf(String(issueNum));
            if (tabIndex >= 0) {
                updateTabTitle(tabIndex, t);
            }

            // 为每个代码块注入右上角复制按钮，并设置布局
            const pres = bodyEl.querySelectorAll('pre');
            pres.forEach(pre => {
                try {
                    pre.style.marginTop = '5px';
                    pre.style.marginBottom = '5px';
                    pre.style.cursor = 'pointer';
                    pre.style.transition = 'background-color 0.15s ease';
                    // 点击代码块复制
                    pre.addEventListener('click', async (e) => {
                        const codeEl = pre.querySelector('code');
                        const text = codeEl ? codeEl.textContent : pre.textContent;
                        const cleanText = String(text || '').trim();
                        try {
                            if (typeof GM_setClipboard === 'function') {
                                GM_setClipboard(cleanText, 'text');
                            } else if (navigator.clipboard && navigator.clipboard.writeText) {
                                await navigator.clipboard.writeText(cleanText);
                            }
                            // 视觉反馈：短暂闪烁绿色背景
                            const prevBg = pre.style.backgroundColor;
                            pre.style.backgroundColor = 'rgba(46, 160, 67, 0.3)';
                            setTimeout(() => {
                                pre.style.backgroundColor = prevBg;
                            }, 200);
                            if (typeof GM_notification === 'function') {
                                GM_notification({ text: '代码已复制', title: 'CNB 剪贴板', timeout: 1500 });
                            }
                        } catch (_) {}
                    });
                } catch (_) {}
            });

            // 行为增强：为每个代码块提供"两行预览 + 展开/收起"，复制仍复制全文
            try {
              if (typeof GM_addStyle === 'function') {
                addStyleOnce('clipwin-pre-controls', `
                  .cnb-pre-collapsed {
                                max-height: 3.2em; /* 约两行 */
                                overflow: hidden;
                                position: relative;
                              }
                              .cnb-pre-collapsed::after {
                                content: '';
                                position: absolute;
                                left: 0; right: 0; bottom: 0;
                                height: 28px;
                                background: linear-gradient(to bottom, rgba(11,16,33,0), rgba(11,16,33,0.85));
                                pointer-events: none;
                              }
                              /* 顶部右侧控制容器：右为复制，左为展开 */
                              .cnb-code-controls {
                                position: absolute;
                                top: 4px;
                                right: 6px;
                                display: inline-flex;
                                align-items: center;
                                gap: 6px;
                              }
                              .cnb-code-controls .cnb-codecopy-inline,
                              .cnb-code-controls .cnb-code-toggle {
                                border: 2px solid #fff;
                                background: rgba(255,255,255,0.15);
                                color: #fff;
                                padding: 4px 6px;
                                border-radius: 0;
                                cursor: pointer;
                                line-height: 1;
                                display: inline-flex;
                                align-items: center;
                                justify-content: center;
                                font-size: 12px;
                                font-weight: 600;
                                transition: all 0.1s ease;
                              }
                              .cnb-code-controls .cnb-codecopy-inline:hover,
                              .cnb-code-controls .cnb-code-toggle:hover {
                                background: #fff;
                                color: #000;
                              }
                            `);
                          }
                        } catch (_) {}
                        try {
                          const pres2 = bodyEl ? bodyEl.querySelectorAll('pre') : [];
                          pres2.forEach(pre => {
                            try {
                              const codeEl = pre.querySelector('code') || pre;
                              const text = codeEl ? (codeEl.textContent || '') : (pre.textContent || '');
                              const lines = String(text || '').split('\n');
                              if (lines.length <= 2) return;
                              // 初始折叠为两行
                              pre.classList.add('cnb-pre-collapsed');
                              // 若不存在展开按钮则添加
                              /* 将展开按钮插入到右上角控制容器中，位于复制按钮左侧 */
                              // 确保控制容器存在
                              let __controls = pre.querySelector('.cnb-code-controls');
                              if (!__controls) {
                                __controls = document.createElement('div');
                                __controls.className = 'cnb-code-controls';
                                pre.appendChild(__controls);
                              }
                              if (!pre.querySelector('.cnb-code-toggle')) {
                                const tbtn = document.createElement('button');
                                tbtn.type = 'button';
                                tbtn.className = 'cnb-code-toggle';
                                tbtn.textContent = '展开';
                                tbtn.title = '展开/收起';
                                tbtn.addEventListener('mouseenter', () => { tbtn.style.background = '#fff'; tbtn.style.color = '#000'; });
                                tbtn.addEventListener('mouseleave', () => { tbtn.style.background = 'rgba(255,255,255,0.15)'; tbtn.style.color = '#fff'; });
                                tbtn.addEventListener('click', (e) => {
                                  e.stopPropagation();
                                  const collapsed = pre.classList.toggle('cnb-pre-collapsed');
                                  tbtn.textContent = collapsed ? '展开' : '收起';
                                });
                                __controls.appendChild(tbtn);
                              }
                            } catch (_) {}
                          });
                        } catch (_) {}

            // 渲染后隐藏 h2，并收紧 pre 间距与清理多余换行
            try {
                if (bodyEl) {
                    // 隐藏所有 h2，去除占位
                    bodyEl.querySelectorAll('h2').forEach(h => {
                        h.style.display = 'none';
                        h.style.margin = '0';
                        h.style.padding = '0';
                    });
                    // 移除所有 <br> 与空段落，避免形成额外间隙
                    bodyEl.querySelectorAll('br').forEach(br => br.remove());
                    bodyEl.querySelectorAll('p').forEach(p => {
                        const txt = (p.textContent || '').trim();
                        const onlyBr = p.children.length === 1 && p.firstElementChild && p.firstElementChild.tagName.toLowerCase() === 'br';
                        if (!txt || onlyBr) p.remove();
                    });
                    // 统一设置代码块上下间距与内边距
                    bodyEl.querySelectorAll('pre').forEach(pre => {
                        pre.style.marginTop = '0';
                        pre.style.marginBottom = '0';
                    });
                    // 额外收紧：取消段落与分段容器的默认间距
                    bodyEl.querySelectorAll('p').forEach(p => {
                        p.style.marginTop = '0';
                        p.style.marginBottom = '0';
                    });
                    bodyEl.querySelectorAll('.cnb-sec').forEach(sec => {
                        sec.style.margin = '0';
                        sec.style.padding = '0';
                    });
                }
            } catch (_) {}

            // 基于 h2 构建章节按键并切换显示
            try {
              const contentDiv = dialog.querySelector('.cnb-clipwin-content');
              const h2s = (bodyEl && bodyEl.querySelectorAll) ? bodyEl.querySelectorAll('h2') : [];
              if (contentDiv && h2s.length > 1) {
                const sections = [];
                for (let i = 0; i < h2s.length; i++) {
                  const h = h2s[i];
                  const sec = document.createElement('div');
                  sec.className = 'cnb-sec';
                  // 将 h2 及其之后内容（直到下一个 h2）打包进 section
                  h.parentNode.insertBefore(sec, h);
                  sec.appendChild(h);
                  let next = sec.nextSibling;
                  while (next && !(next.nodeType === 1 && next.tagName && next.tagName.toLowerCase() === 'h2')) {
                    const move = next;
                    next = next.nextSibling;
                    sec.appendChild(move);
                  }
                  sections.push(sec);
                }
                // 在正文之前插入 tabs 容器（注入样式 - 扁平黑白配色）
                try {
                  if (typeof GM_addStyle === 'function') {
                    GM_addStyle(`
                      .cnb-clipwin-tabs-inline {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 4px;
                        margin: 4px 0 6px;
                      }
                      .cnb-tab-inline {
                        appearance: none;
                        border: 2px solid #000;
                        border-radius: 0;
                        padding: 4px 10px;
                        background: #fff;
                        color: #000;
                        cursor: pointer;
                        font-size: 11px;
                        font-weight: 500;
                        line-height: 1.1;
                        transition: all 0.1s ease;
                      }
                      .cnb-tab-inline:hover {
                        background: #000;
                        color: #fff;
                      }
                      .cnb-tab-inline.active {
                        background: #000;
                        color: #fff;
                      }
                      .cnb-tab-inline:focus {
                        outline: none;
                      }
                    `);
                  }
                } catch (_) {}
                let tabsInline = contentDiv.querySelector('.cnb-clipwin-tabs-inline');
                if (!tabsInline) {
                  tabsInline = document.createElement('div');
                  tabsInline.className = 'cnb-clipwin-tabs-inline';
                  contentDiv.insertBefore(tabsInline, bodyEl);
                } else {
                  tabsInline.innerHTML = '';
                }
                h2s.forEach((h, idx) => {
                  const btn = document.createElement('button');
                  btn.type = 'button';
                  btn.textContent = (h.textContent || '').trim() || ('Section ' + (idx + 1));
                  btn.className = 'cnb-tab-inline';
                  btn.addEventListener('click', () => {
                    // 确保窗口使用固定定位而不是transform居中
                    if (dialog.style.transform && dialog.style.transform !== 'none') {
                      const rect = dialog.getBoundingClientRect();
                      dialog.style.left = rect.left + 'px';
                      dialog.style.top = rect.top + 'px';
                      dialog.style.transform = 'none';
                    }
                    sections.forEach((s, j) => { s.style.display = (j === idx) ? '' : 'none'; });
                    Array.from(tabsInline.children).forEach((b, i) => {
                      b.classList.toggle('active', i === idx);
                    });
                  });
                  tabsInline.appendChild(btn);
                });
                // 默认激活第一个
                if (tabsInline.firstElementChild) {
                  tabsInline.firstElementChild.click();
                }
                // 内容首次渲染后，固定窗口位置（避免后续切换tab时从居中动画）
                if (dialog.style.transform && dialog.style.transform !== 'none') {
                  const rect = dialog.getBoundingClientRect();
                  dialog.style.left = rect.left + 'px';
                  dialog.style.top = rect.top + 'px';
                  dialog.style.transform = 'none';
                }
              }
            } catch (_) {}
        }

        // 函数：创建 Issue 标签按钮（显示标题而不是编号）
        function createIssueTabs() {
            tabsEl.innerHTML = '';

            // 读取保存的 Issue 标题
            let issueTitles = {};
            try {
                if (typeof GM_getValue === 'function') {
                    const titles = GM_getValue('cnbClipboardIssueTitles', '{}');
                    issueTitles = typeof titles === 'object' ? titles : {};
                }
            } catch (_) {}

            issueList.forEach((issueNum, index) => {
                const tab = document.createElement('button');
                tab.type = 'button';
                tab.className = 'cnb-clipwin-tab';
                // 优先显示保存的标题，否则显示编号
                tab.textContent = issueTitles[String(issueNum)] || issueNum;
                tab.dataset.issueNum = issueNum;
                tab.dataset.index = index;

                if (index === currentIssueIndex) {
                    tab.classList.add('active');
                }

                tab.addEventListener('click', () => {
                    // 更新激活状态
                    currentIssueIndex = index;
                    Array.from(tabsEl.children).forEach((b, i) => {
                        b.classList.toggle('active', i === index);
                    });
                    // 加载对应 Issue
                    loadIssue(issueNum, index);
                });

                tabsEl.appendChild(tab);
            });
        }

        // 函数：更新标签文本为 Issue 标题
        function updateTabTitle(index, title) {
            const tab = tabsEl.children[index];
            if (tab && title) {
                tab.textContent = title;
            }
        }

        // 创建标签按钮
        createIssueTabs();

        // 如果有保存的窗口位置，应用它
        if (__clipWinPos.left !== null && __clipWinPos.top !== null) {
            dialog.style.left = __clipWinPos.left + 'px';
            dialog.style.top = __clipWinPos.top + 'px';
            dialog.style.transform = 'none';
        }

        if (issueList.length === 0) {
            if (bodyEl) bodyEl.textContent = '未配置剪贴板位置';
            return;
        }

        // 只在多个 Issue 时显示并初始化标签位置
        if (issueList.length > 1) {
            // 初始化标签位置（在窗口左侧，等标签创建完成后）
            tabsContainer.style.display = 'flex';
            // 强制重排确保 DOM 完全渲染
            void tabsContainer.offsetHeight;
            const rect = dialog.getBoundingClientRect();
            const tabWidth = tabsContainer.offsetWidth || 80;
            tabsContainer.style.left = (rect.left - tabWidth) + 'px';
            tabsContainer.style.top = (rect.top + 29) + 'px';
            tabsContainer.style.transform = 'none';
        } else {
            // 只有一个 Issue 时隐藏标签容器
            tabsContainer.style.display = 'none';
        }

        // 加载默认 Issue（第一个）
        loadIssue(issueList[0], 0);
    }

    // 创建Issue
    function createIssue(title, content, labels = [], callback) {
        if (!CONFIG.repoPath || !CONFIG.accessToken) {
            if (typeof GM_notification === 'function') {
                GM_notification({ text: '请先在设置中配置仓库路径与访问令牌', title: 'CNB Issue工具', timeout: 3000 });
            }
            if (typeof openSettingsDialog === 'function') openSettingsDialog();
            if (typeof callback === 'function') callback(false);
            return;
        }
        const issueData = {
            repoId: CONFIG.repoPath,
            title: title,
            body: content,
            labels: labels,
            assignees: []
        };

        const apiUrl = `${CONFIG.apiBase}/${CONFIG.repoPath}${CONFIG.issueEndpoint}`;



        GM_xmlhttpRequest({
            method: 'POST',
            url: apiUrl,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `${CONFIG.accessToken}`,
                'Accept': 'application/json'
            },
            data: JSON.stringify(issueData),
            responseType: 'json',
            onload: function(response) {
                if (response.status === 200 || response.status === 201) {
                    // 解析返回，取 issueId（兼容不同字段）
                    let respObj = null;
                    try {
                        respObj = typeof response.response === 'object' && response.response !== null
                          ? response.response
                          : JSON.parse(response.responseText || '{}');
                    } catch (_) {
                        respObj = null;
                    }
                    const issueId = respObj?.id ?? respObj?.number ?? respObj?.iid ?? respObj?.issue_id;

                    const notifySuccess = () => {
                        GM_notification({
                            text: `Issue创建成功！`,
                            title: 'CNB Issue工具',
                            timeout: 3000
                        });
                        if (callback) callback(true, issueId);
                    };

                    // 若有标签，则单独 PUT 标签
                    if (Array.isArray(labels) && labels.length > 0 && issueId != null) {
                        const labelsUrl = `${CONFIG.apiBase}/${CONFIG.repoPath}${CONFIG.issueEndpoint}/${issueId}/labels`;
                        GM_xmlhttpRequest({
                            method: 'PUT',
                            url: labelsUrl,
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `${CONFIG.accessToken}`,
                                'Accept': 'application/json'
                            },
                            data: JSON.stringify({ labels }),
                            responseType: 'json',
                            onload: function(res2) {
                                if (res2.status >= 200 && res2.status < 300) {
                                    notifySuccess();
                                } else {
                                    let msg = `HTTP ${res2.status}`;
                                    try {
                                        const err = typeof res2.response === 'string'
                                          ? JSON.parse(res2.response) : res2.response;
                                        if (err?.message) msg = err.message;
                                    } catch (_) {}
                                    GM_notification({
                                        text: `Issue已创建，但设置标签失败：${msg}`,
                                        title: 'CNB Issue工具',
                                        timeout: 5000
                                    });
                                    if (callback) callback(true, issueId);
                                }
                            },
                            onerror: function() {
                                GM_notification({
                                    text: `Issue已创建，但设置标签时网络错误`,
                                    title: 'CNB Issue工具',
                                    timeout: 5000
                                });
                                if (callback) callback(true, issueId);
                            }
                        });
                    } else {
                        // 无标签或无法解析 issueId，直接成功
                        notifySuccess();
                    }
                } else {
                    let errorMsg = `HTTP ${response.status}`;
                    try {
                        const errorData = typeof response.response === 'string' ?
                            JSON.parse(response.response) : response.response;
                        if (errorData && errorData.message) {
                            errorMsg = errorData.message;
                        }
                    } catch (e) {}

                    GM_notification({
                        text: `创建失败: ${errorMsg}`,
                        title: 'CNB Issue工具',
                        timeout: 5000
                    });
                    if (callback) callback(false);
                }
            },
            onerror: function(error) {
                GM_notification({
                    text: `网络请求失败`,
                    title: 'CNB Issue工具',
                    timeout: 5000
                });
                if (callback) callback(false);
            }
        });
    }

    // 关闭Issue（设置为 closed，state_reason=completed）
    function closeIssue(issueId, stateReason = 'completed', callback) {
        if (issueId == null) {
            if (typeof callback === 'function') callback(false);
            return;
        }
        const url = `${CONFIG.apiBase}/${CONFIG.repoPath}${CONFIG.issueEndpoint}/${issueId}`;
        GM_xmlhttpRequest({
            method: 'PATCH',
            url,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `${CONFIG.accessToken}`,
                'Accept': 'application/json'
            },
            data: JSON.stringify({
                state: 'closed',
                state_reason: stateReason
            }),
            responseType: 'json',
            onload: function(res) {
                if (res.status >= 200 && res.status < 300) {
                    if (typeof callback === 'function') callback(true);
                } else {
                    let msg = `HTTP ${res.status}`;
                    try {
                        const err = typeof res.response === 'string' ? JSON.parse(res.response) : res.response;
                        if (err?.message) msg = err.message;
                    } catch (_) {}
                    if (typeof GM_notification === 'function') {
                        GM_notification({
                            text: `标记完成失败：${msg}`,
                            title: 'CNB Issue工具',
                            timeout: 5000
                        });
                    }
                    if (typeof callback === 'function') callback(false);
                }
            },
            onerror: function() {
                if (typeof GM_notification === 'function') {
                    GM_notification({
                        text: `网络请求失败（关闭Issue）`,
                        title: 'CNB Issue工具',
                        timeout: 5000
                    });
                }
                if (typeof callback === 'function') callback(false);
            }
        });
    }

    // 更新Issue
    function updateIssue(issueNumber, data, callback) {
        if (!CONFIG.repoPath || !CONFIG.accessToken) {
            if (typeof GM_notification === 'function') {
                GM_notification({ text: '请先在设置中配置仓库路径与访问令牌', title: 'CNB Issue工具', timeout: 3000 });
            }
            if (typeof callback === 'function') callback(false);
            return;
        }

        const url = `${CONFIG.apiBase}/${CONFIG.repoPath}${CONFIG.issueEndpoint}/${issueNumber}`;
        GM_xmlhttpRequest({
            method: 'PATCH',
            url,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `${CONFIG.accessToken}`,
                'Accept': 'application/vnd.cnb.api+json'
            },
            data: JSON.stringify(data),
            responseType: 'json',
            onload: function(res) {
                if (res.status >= 200 && res.status < 300) {
                    if (typeof GM_notification === 'function') {
                        GM_notification({
                            text: `Issue #${issueNumber} 更新成功！`,
                            title: 'CNB Issue工具',
                            timeout: 3000
                        });
                    }
                    if (typeof callback === 'function') callback(true);
                } else {
                    let msg = `HTTP ${res.status}`;
                    try {
                        const err = typeof res.response === 'string' ? JSON.parse(res.response) : res.response;
                        if (err?.message) msg = err.message;
                    } catch (_) {}
                    if (typeof GM_notification === 'function') {
                        GM_notification({
                            text: `更新失败：${msg}`,
                            title: 'CNB Issue工具',
                            timeout: 5000
                        });
                    }
                    if (typeof callback === 'function') callback(false);
                }
            },
            onerror: function() {
                if (typeof GM_notification === 'function') {
                    GM_notification({
                        text: `网络请求失败（更新Issue）`,
                        title: 'CNB Issue工具',
                        timeout: 5000
                    });
                }
                if (typeof callback === 'function') callback(false);
            }
        });
    }

    // 添加评论到Issue
    function addCommentToIssue(issueNumber, body, callback) {
        if (!CONFIG.repoPath || !CONFIG.accessToken) {
            if (typeof GM_notification === 'function') {
                GM_notification({ text: '请先在设置中配置仓库路径与访问令牌', title: 'CNB Issue工具', timeout: 3000 });
            }
            if (typeof callback === 'function') callback(false);
            return;
        }

        const url = `${CONFIG.apiBase}/${CONFIG.repoPath}${CONFIG.issueEndpoint}/${issueNumber}/comments`;
        GM_xmlhttpRequest({
            method: 'POST',
            url,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `${CONFIG.accessToken}`,
                'Accept': 'application/vnd.cnb.api+json'
            },
            data: JSON.stringify({ body }),
            responseType: 'json',
            onload: function(res) {
                if (res.status >= 200 && res.status < 300) {
                    if (typeof GM_notification === 'function') {
                        GM_notification({
                            text: `评论添加成功！`,
                            title: 'CNB Issue工具',
                            timeout: 3000
                        });
                    }
                    if (typeof callback === 'function') callback(true);
                } else {
                    let msg = `HTTP ${res.status}`;
                    try {
                        const err = typeof res.response === 'string' ? JSON.parse(res.response) : res.response;
                        if (err?.message) msg = err.message;
                    } catch (_) {}
                    if (typeof GM_notification === 'function') {
                        GM_notification({
                            text: `添加评论失败：${msg}`,
                            title: 'CNB Issue工具',
                            timeout: 5000
                        });
                    }
                    if (typeof callback === 'function') callback(false);
                }
            },
            onerror: function() {
                if (typeof GM_notification === 'function') {
                    GM_notification({
                        text: `网络请求失败（添加评论）`,
                        title: 'CNB Issue工具',
                        timeout: 5000
                    });
                }
                if (typeof callback === 'function') callback(false);
            }
        });
    }

    // 1. 获取上传凭证
    function requestUploadToken(fileName, fileSize, callback) {
        if (!CONFIG.repoPath || !CONFIG.accessToken) {
            if (typeof callback === 'function') callback(null, '请先配置仓库路径和访问令牌');
            return;
        }

        const uploadUrl = `${CONFIG.apiBase}/${CONFIG.repoPath}/-/upload/imgs`;

        GM_xmlhttpRequest({
            method: 'POST',
            url: uploadUrl,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': CONFIG.accessToken,
                'Accept': 'application/json'
            },
            data: JSON.stringify({ name: fileName, size: fileSize, ext: {} }),
            responseType: 'json',
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    const resp = response.response || JSON.parse(response.responseText || '{}');
                    if (callback) callback(resp, null);
                    return;
                }

                let errorMsg = `HTTP ${response.status}`;
                const err = typeof response.response === 'string'
                    ? JSON.parse(response.response || '{}') : response.response;

                if (err?.message) errorMsg = err.message;

                // 特殊处理权限错误 (errcode: 7)
                if (err?.errcode === 7 && err?.errmsg?.includes('票据授权范围')) {
                    errorMsg = '访问令牌缺少 repo-contents:rw 权限';
                    if (typeof GM_notification === 'function') {
                        GM_notification({
                            text: '图片上传失败：访问令牌缺少 repo-contents:rw 权限',
                            title: 'CNB Issue工具',
                            timeout: 5000
                        });
                    }
                }

                if (callback) callback(null, errorMsg);
            },
            onerror: function() {
                if (callback) callback(null, '网络请求失败');
            }
        });
    }

    // 2. 上传图片到 OSS
    function uploadImageToOss(uploadInfo, fileData, callback) {
        if (!uploadInfo?.upload_url) {
            if (callback) callback(null, '上传凭证无效');
            return;
        }

        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadInfo.upload_url);
        xhr.setRequestHeader('Content-Type', fileData.type || 'application/octet-stream');

        // 添加额外的表单参数作为请求头
        if (uploadInfo.form) {
            Object.entries(uploadInfo.form).forEach(([key, value]) => {
                if (key.toLowerCase() !== 'file') {
                    xhr.setRequestHeader(key, value);
                }
            });
        }

        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
                const relativePath = uploadInfo.assets?.path || '';
                const fullUrl = relativePath.includes(CONFIG.repoPath)
                    ? `https://cnb.cool${relativePath}`
                    : `https://cnb.cool/${CONFIG.repoPath}${relativePath}`;
                if (callback) callback(fullUrl, null);
                return;
            }

            let errorMsg = `HTTP ${xhr.status}`;
            try {
                if (xhr.responseText) {
                    const err = JSON.parse(xhr.responseText);
                    if (err?.message) errorMsg = err.message;
                }
            } catch (_) {}

            if (callback) callback(null, errorMsg);
        };

        xhr.onerror = function() {
            if (callback) callback(null, '图片上传失败');
        };

        xhr.send(fileData);
    }

    // 3. 获取图片数据（从 URL 或 base64）
    function fetchImageData(imageUrl, callback) {
        // 如果是 base64 数据
        if (imageUrl.startsWith('data:')) {
            const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
                const mimeType = matches[1];
                const base64Data = matches[2];
                try {
                    const byteString = atob(base64Data);
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    for (let i = 0; i < byteString.length; i++) {
                        ia[i] = byteString.charCodeAt(i);
                    }
                    const blob = new Blob([ab], { type: mimeType });
                    if (callback) callback(blob, null);
                    return;
                } catch (e) {
                    if (callback) callback(null, 'base64 解析失败');
                    return;
                }
            }
        }

        // 通过 URL 获取图片 - 使用 fetch
        fetch(imageUrl, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.blob();
        })
        .then(blob => {
            if (callback) callback(blob, null);
        })
        .catch(error => {
            // 如果 fetch 失败，尝试使用 GM_xmlhttpRequest
            GM_xmlhttpRequest({
                method: 'GET',
                url: imageUrl,
                responseType: 'arraybuffer',
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        const arrayBuffer = response.response;
                        if (arrayBuffer) {
                            const blob = new Blob([arrayBuffer]);
                            if (callback) callback(blob, null);
                        } else {
                            if (callback) callback(null, '获取图片数据失败');
                        }
                    } else {
                        if (callback) callback(null, `HTTP ${response.status}`);
                    }
                },
                onerror: function() {
                    if (callback) callback(null, '获取图片失败');
                }
            });
        });
    }

    // 4. 从Markdown内容中提取图片链接
    function extractImagesFromMarkdown(markdown) {
        const images = [];
        // 匹配 Markdown 图片语法: ![alt](url)
        const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        let match;
        const seenSrcs = new Set();

        while ((match = imgRegex.exec(markdown)) !== null) {
            const src = match[2];
            if (!seenSrcs.has(src)) {
                seenSrcs.add(src);
                images.push({ src: src, alt: match[1] });
            }
        }

        return images;
    }

    // 5. 批量上传图片并替换 Markdown 中的 URL
    function uploadImagesAndReplace(markdown, images, callback) {
        if (!images || images.length === 0) {
            if (callback) callback(markdown, []);
            return;
        }

        const uploadPromises = [];
        const errors = [];

        // 处理每个图片
        images.forEach((imgInfo, index) => {
            const promise = new Promise((resolve) => {
                // 从 URL 获取文件名
                let fileName = 'image.png';
                try {
                    const urlParts = new URL(imgInfo.src, location.href);
                    const pathname = urlParts.pathname;
                    const filenameMatch = pathname.match(/([^\/]+)\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i);
                    if (filenameMatch) {
                        fileName = filenameMatch[1].substring(0, 50) + '.' + filenameMatch[2];
                    }
                } catch (_) {}

                fetchImageData(imgInfo.src, (blob, error) => {
                    if (error || !blob) {
                        errors.push({ src: imgInfo.src, error: error || '获取图片失败' });
                        resolve({ oldSrc: imgInfo.src, newSrc: null });
                        return;
                    }

                    const fileSize = blob.size;

                    // 请求上传凭证
                    requestUploadToken(fileName, fileSize, (uploadInfo, tokenError) => {
                        if (tokenError || !uploadInfo) {
                            errors.push({ src: imgInfo.src, error: tokenError || '获取上传凭证失败' });
                            resolve({ oldSrc: imgInfo.src, newSrc: null });
                            return;
                        }

                        // 上传到 OSS
                        uploadImageToOss(uploadInfo, blob, (newPath, uploadError) => {
                            if (uploadError || !newPath) {
                                errors.push({ src: imgInfo.src, error: uploadError || '上传图片失败' });
                                resolve({ oldSrc: imgInfo.src, newSrc: null });
                            } else {
                                resolve({ oldSrc: imgInfo.src, newSrc: newPath });
                            }
                        });
                    });
                });
            });
            uploadPromises.push(promise);
        });

        // 等待所有上传完成
        Promise.all(uploadPromises).then((results) => {
            // 替换 Markdown 中的图片 URL
            let updatedMarkdown = markdown;
            results.forEach(result => {
                if (result.newSrc) {
                    // 替换 Markdown 中的图片引用
                    const escapedOldSrc = result.oldSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    updatedMarkdown = updatedMarkdown.replace(
                        new RegExp(`!\\[([^\\]]*)\\]\\(${escapedOldSrc}\\)`, 'g'),
                        `![$1](${result.newSrc})`
                    );
                }
            });

            if (callback) callback(updatedMarkdown, errors);
        });
    }

    // 检查是否为 cnb.cool 域名
    function isCnbDomain() {
        return /\b(^|\.)cnb\.cool$/i.test(location.hostname);
    }

    // 直达目标解码：获取 cnb.cool /数字?url= 的目标地址
    function getCnbGotoTarget(urlLike) {
        try {
            const u = new URL(urlLike, location.href);
            const raw = u.searchParams.get('url') || '';
            if (!raw) return '';

            // 解码 1-2 次，兼容已编码/双重编码
            let t = decodeURIComponent(raw);
            if (/%[0-9A-Fa-f]{2}/.test(t)) {
                try { t = decodeURIComponent(t); } catch (_) {}
            }

            // 只允许 http/https
            return /^https?:\/\//i.test(t) ? t : '';
        } catch (_) {
            return '';
        }
    }

    // 若当前位于 cnb.cool 的数字跳转页，立即重定向到真实目标
    function handleCnbGotoPage() {
        if (!isCnbDomain()) return;
        if (!location.pathname.match(/^\/(\d+)$/)) return;
        if (!location.search.includes('url=')) return;

        const target = getCnbGotoTarget(location.href);
        if (target) location.replace(target);
    }

    // 将页面内所有 数字?url= 链接批量改写为直链
    function rewriteCnbGotoLinks(root = document) {
        if (!isCnbDomain()) return;

        root.querySelectorAll('a[href*="?url="]').forEach(a => {
            try {
                const href = a.getAttribute('href');
                if (!href) return;

                const absUrl = new URL(href, location.href).href;
                if (!absUrl.includes('cnb.cool/') || !/\/(\d+)\?url=/i.test(absUrl)) return;

                const target = getCnbGotoTarget(absUrl);
                if (target) a.href = target;
            } catch (_) {}
        });
    }

    // 事件委托兜底：拦截点击数字跳转链接并直接打开目标
    function cnbGotoClickHandler(e) {
        if (!isCnbDomain()) return;

        // 查找被点击的 <a> 元素
        let el = e.target;
        while (el && el !== document && !(el instanceof HTMLAnchorElement)) {
            el = el.parentElement;
        }
        if (!(el instanceof HTMLAnchorElement)) return;

        const href = el.getAttribute('href');
        if (!href) return;

        const absUrl = new URL(href, location.href).href;
        if (!/\/(\d+)\?url=/i.test(absUrl)) return;

        const target = getCnbGotoTarget(absUrl);
        if (!target) return;

        e.preventDefault();
        e.stopPropagation();

        // 兼容中键或带修饰键的新开方式
        const newTab = e.button === 1 || e.ctrlKey || e.metaKey;
        if (newTab) {
            window.open(target, '_blank', 'noopener');
        } else {
            location.href = target;
        }
    }

    // 清理资源
    function cleanup() {
        try { if (__CNB_MO) { __CNB_MO.disconnect(); __CNB_MO = null; } } catch (_) {}
        try { if (__CNB_CLIP_DIALOG?.parentNode) { __CNB_CLIP_DIALOG.remove(); __CNB_CLIP_DIALOG = null; } } catch (_) {}
    }

    // 初始化 cnb.cool 相关功能
    function initCnbFeatures() {
        if (!isCnbDomain()) return;

        handleCnbGotoPage();
        rewriteCnbGotoLinks(document);
        document.addEventListener('click', cnbGotoClickHandler, true);

        try {
            __CNB_MO = new MutationObserver(mutations => {
                mutations.forEach(m => {
                    m.addedNodes?.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            rewriteCnbGotoLinks(node);
                        }
                    });
                });
            });
            __CNB_MO.observe(document.documentElement || document.body, { childList: true, subtree: true });
        } catch (_) {}

        if (!__CNB_UNLOAD_BOUND) {
            window.addEventListener('beforeunload', cleanup, { once: true });
            __CNB_UNLOAD_BOUND = true;
        }
    }

    // 读取持久化配置
    function loadPersistedConfig() {
        try {
            if (typeof GM_getValue !== 'function') return;

            const repo = GM_getValue('repoPath', CONFIG.repoPath);
            const token = GM_getValue('accessToken', CONFIG.accessToken);
            const tags = GM_getValue('cnbTags', []);
            const hk = GM_getValue('cnbHotkey', START_HOTKEY);
            const hkEnabled = GM_getValue('cnbHotkeyEnabled', HOTKEY_ENABLED);
            const uploadEnabled = GM_getValue('cnbUploadEnabled', true);

            if (repo) CONFIG.repoPath = repo;
            if (token) CONFIG.accessToken = token;
            if (Array.isArray(tags)) SAVED_TAGS = tags;
            if (hk) START_HOTKEY = normalizeHotkeyString(hk);
            HOTKEY_ENABLED = !!hkEnabled;
            CONFIG.uploadEnabled = !!uploadEnabled;
        } catch (_) {}
    }

    // 初始化
    function init() {
        loadPersistedConfig();
        createFloatingButton();
        initCnbFeatures();
        document.addEventListener('keydown', globalHotkeyHandler, true);
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();