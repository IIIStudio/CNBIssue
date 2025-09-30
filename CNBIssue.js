// ==UserScript==
// @name         CNB Issue 区域选择工具 (Markdown版)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  选择页面区域并转换为Markdown发送到CNB创建Issue
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
// ==/UserScript==

(function() {
    'use strict';

    // 配置信息
    const CONFIG = {
        apiBase: 'https://api.cnb.cool',
        repoPath: '',
        accessToken: '',
        issueEndpoint: '/-/issues'
    };

    // 添加自定义样式
    GM_addStyle(`
        .cnb-issue-floating-btn {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            background: #0366d6;
            color: white;
            border: none;
            border-radius: 50%;
            width: 50px;
            height: 50px;
            cursor: pointer;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            font-size: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
        }
        .cnb-issue-floating-btn:hover {
            background: #0256b9;
            transform: scale(1.1);
        }
        .cnb-issue-dialog {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 20px;
            z-index: 10001;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            min-width: 500px;
            max-width: 90vw;
            max-height: 80vh;
            overflow: auto;
        }
        .cnb-issue-dialog h3 {
            margin: 0 0 15px 0;
            color: #333;
        }
        .cnb-issue-dialog textarea {
            width: 100%;
            height: 300px;
            margin: 10px 0;
            padding: 10px;
            border: 1px solid #ccc;
            border-radius: 4px;
            resize: vertical;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 12px;
            line-height: 1.4;
        }
        .cnb-issue-dialog input {
            width: 100%;
            margin: 10px 0;
            padding: 8px;
            border: 1px solid #ccc;
            border-radius: 4px;
        }
        .cnb-issue-dialog-buttons {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 15px;
        }
        .cnb-issue-dialog button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .cnb-issue-btn-confirm {
            background: #0366d6;
            color: white;
        }
        .cnb-issue-btn-cancel {
            background: #6c757d;
            color: white;
        }
        .cnb-issue-btn-confirm:hover {
            background: #0256b9;
        }
        .cnb-issue-btn-cancel:hover {
            background: #5a6268;
        }
        .cnb-issue-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 10000;
        }
        .cnb-issue-loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #0366d6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 10px;
        }

        /* 区域选择模式样式 */
        .cnb-selection-mode * {
            cursor: crosshair !important;
        }
        .cnb-selection-hover {
            outline: 2px solid #0366d6 !important;
            background-color: rgba(3, 102, 214, 0.1) !important;
        }
        .cnb-selection-selected {
            outline: 3px solid #28a745 !important;
            background-color: rgba(40, 167, 69, 0.15) !important;
        }
        .cnb-selection-tooltip {
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: #333;
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            z-index: 10002;
            font-size: 14px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        }
        .cnb-selection-tooltip button {
            margin-left: 10px;
            padding: 4px 8px;
            background: #28a745;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `);

    // 追加设置按钮样式
    GM_addStyle(`
        .cnb-issue-settings-btn {
            position: fixed;
            z-index: 10000;
            background: #6c757d;
            color: white;
            border: none;
            border-radius: 50%;
            width: 44px;
            height: 44px;
            cursor: pointer;
            box-shadow: 0 2px 10px rgba(0,0,0,0.25);
            font-size: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        }
        .cnb-issue-settings-btn:hover {
            background: #5a6268;
            transform: scale(1.05);
        }
    `);

    let isSelecting = false;
    let selectedElement = null;

    // HTML转Markdown的转换器
    const htmlToMarkdown = {
        // 转换入口函数
        convert: function(html) {
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
                '.ads', '.advertisement', '[class*="ad"]',
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
                    return `\`\`\`${language}\n${childrenContent}\n\`\`\`\n\n`;
                case 'a':
                    const href = node.getAttribute('href') || '';
                    if (href) {
                        return `[${childrenContent}](${href})`;
                    }
                    return childrenContent;
                case 'img':
                    const src = node.getAttribute('src') || '';
                    const alt = node.getAttribute('alt') || '';
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
                .replace(/-/g, '\\-')
                .replace(/!/g, '\\!')
                .replace(/\|/g, '\\|')
                .replace(/\n\s*\n/g, '\n\n')
                .replace(/\s+/g, ' ')
                .trim();
        }
    };

    // 创建悬浮按钮（可拖动）+ 设置按钮
    function createFloatingButton() {
        const btn = document.createElement('button');
        btn.className = 'cnb-issue-floating-btn';
        btn.innerHTML = '📝';
        btn.title = '选择页面区域创建CNB Issue (Markdown格式)';

        const setBtn = document.createElement('button');
        setBtn.className = 'cnb-issue-settings-btn';
        setBtn.innerHTML = '⚙️';
        setBtn.title = '设置 CNB 仓库与 Token';

        document.body.appendChild(btn);
        document.body.appendChild(setBtn);

        // 初始位置（读取存储，没有则右上角）
        const savedPos = (typeof GM_getValue === 'function') ? GM_getValue('btnPos', null) : null;
        const startTop = savedPos?.top ?? 20;
        const startLeft = savedPos?.left ?? (window.innerWidth - 70);
        positionButtons(startLeft, startTop);

        // 拖拽逻辑
        let dragging = false;
        let moved = false;
        let startX = 0, startY = 0;
        let origLeft = 0, origTop = 0;

        btn.addEventListener('mousedown', (e) => {
            dragging = true;
            moved = false;
            startX = e.clientX;
            startY = e.clientY;
            const rect = btn.getBoundingClientRect();
            origLeft = rect.left;
            origTop = rect.top;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
            let newLeft = origLeft + dx;
            let newTop = origTop + dy;
            // 边界限制
            const margin = 10;
            const maxLeft = window.innerWidth - btn.offsetWidth - margin;
            const maxTop = window.innerHeight - btn.offsetHeight - margin;
            newLeft = Math.max(margin, Math.min(maxLeft, newLeft));
            newTop = Math.max(margin, Math.min(maxTop, newTop));
            positionButtons(newLeft, newTop);
        });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            // 保存位置
            const rect = btn.getBoundingClientRect();
            if (typeof GM_setValue === 'function') {
                GM_setValue('btnPos', { left: rect.left, top: rect.top });
            }
        });

        // 点击（区分拖拽）
        btn.addEventListener('click', (e) => {
            if (moved) {
                e.preventDefault();
                return;
            }
            startAreaSelection();
        });

        setBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openSettingsDialog();
        });

        function positionButtons(left, top) {
            btn.style.left = `${left}px`;
            btn.style.top = `${top}px`;
            btn.style.right = 'auto';

            // 设置按钮在主按钮下方偏移
            const btnRect = btn.getBoundingClientRect();
            const gap = 10;
            setBtn.style.left = `${left + (btn.offsetWidth - setBtn.offsetWidth) / 2}px`;
            setBtn.style.top = `${top + btn.offsetHeight + gap}px`;
        }

        return btn;
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
            if (selectedElement) {
                showIssueDialog(selectedElement);
            } else {
                GM_notification({
                    text: '请先选择一个区域',
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

        // 移除样式
        if (selectedElement) {
            selectedElement.classList.remove('cnb-selection-selected');
            selectedElement = null;
        }

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
        if (element !== selectedElement && !element.classList.contains('cnb-issue-floating-btn')) {
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
        if (element !== selectedElement && element.classList.contains('cnb-selection-hover')) {
            element.classList.remove('cnb-selection-hover');
        }
    }

    // 处理元素点击
    function handleElementClick(e) {
        if (!isSelecting) return;

        e.preventDefault();
        e.stopPropagation();

        const element = e.target;

        // 移除之前的选择
        if (selectedElement) {
            selectedElement.classList.remove('cnb-selection-selected');
        }

        // 选择新元素
        selectedElement = element;
        selectedElement.classList.remove('cnb-selection-hover');
        selectedElement.classList.add('cnb-selection-selected');

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
                if (selectedElement) {
                    showIssueDialog(selectedElement);
                }
            });

            cancelBtn.addEventListener('click', stopAreaSelection);
        }
    }

    // 处理按键
    function handleKeyDown(e) {
        if (e.key === 'Escape') {
            stopAreaSelection();
        }
    }

    // 显示创建Issue的对话框
    function showIssueDialog(selectedElement) {
        stopAreaSelection(); // 先退出选择模式

        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'cnb-issue-overlay';

        // 创建对话框
        const dialog = document.createElement('div');
        dialog.className = 'cnb-issue-dialog';

        // 获取选择的内容并转换为Markdown
        const selectedContent = getSelectedContentAsMarkdown(selectedElement);
        const pageTitle = document.title;
        const pageUrl = window.location.href;

        dialog.innerHTML = `
            <h3>创建 CNB Issue (Markdown格式)</h3>
            <div>
                <label>标题:</label>
                <input type="text" id="cnb-issue-title" value="${escapeHtml(pageTitle)}" placeholder="输入Issue标题">
            </div>
            <div>
                <label>Markdown内容:</label>
                <textarea id="cnb-issue-content" placeholder="Markdown内容将自动生成">## 页面信息
**URL:** ${escapeHtml(pageUrl)}
**选择时间:** ${new Date().toLocaleString()}

## 选择的内容

${escapeHtml(selectedContent)}</textarea>
            </div>
            <div>
                <label>标签 (逗号分隔):</label>
                <input type="text" id="cnb-issue-labels" placeholder="bug,enhancement,documentation">
            </div>
            <div class="cnb-issue-dialog-buttons">
                <button class="cnb-issue-btn-cancel">取消</button>
                <button class="cnb-issue-btn-confirm">创建Issue</button>
            </div>
        `;

        // 添加事件监听
        const cancelBtn = dialog.querySelector('.cnb-issue-btn-cancel');
        const confirmBtn = dialog.querySelector('.cnb-issue-btn-confirm');

        const closeDialog = () => {
            if (document.body.contains(overlay)) document.body.removeChild(overlay);
            if (document.body.contains(dialog)) document.body.removeChild(dialog);
        };

        overlay.addEventListener('click', closeDialog);
        cancelBtn.addEventListener('click', closeDialog);

        confirmBtn.addEventListener('click', () => {
            const title = dialog.querySelector('#cnb-issue-title').value;
            const content = dialog.querySelector('#cnb-issue-content').value;
            const labelsInput = dialog.querySelector('#cnb-issue-labels').value;

            const labels = labelsInput.split(',').map(label => label.trim()).filter(label => label);

            // 禁用按钮并显示加载状态
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<div class="cnb-issue-loading"></div>创建中...';

            createIssue(title, content, labels, (success) => {
                if (success) {
                    closeDialog();
                } else {
                    // 重新启用按钮
                    confirmBtn.disabled = false;
                    confirmBtn.innerHTML = '创建Issue';
                }
            });
        });

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

    // 清理Markdown内容
    function cleanMarkdownContent(markdown) {
        return markdown
            .replace(/\n{3,}/g, '\n\n') // 多个空行合并为两个
            .replace(/^\s+|\s+$/g, '') // 去除首尾空白
            .substring(0, 10000); // 限制长度
    }

    // HTML转义
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 设置弹窗
    function openSettingsDialog() {
        const overlay = document.createElement('div');
        overlay.className = 'cnb-issue-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'cnb-issue-dialog';

        const currentRepo = CONFIG.repoPath || '';
        const currentToken = CONFIG.accessToken || '';

        dialog.innerHTML = `
            <h3>CNB 设置</h3>
            <div>
                <label>仓库路径 (owner/repo):</label>
                <input type="text" id="cnb-setting-repo" placeholder="例如: IIIStudio/Demo" value="${escapeHtml(currentRepo)}">
            </div>
            <div>
                <label>访问令牌 (accessToken):</label>
                <input type="password" id="cnb-setting-token" placeholder="输入访问令牌" value="${escapeHtml(currentToken)}">
            </div>
            <div class="cnb-issue-dialog-buttons">
                <button class="cnb-issue-btn-cancel">取消</button>
                <button class="cnb-issue-btn-confirm">保存</button>
            </div>
        `;

        const close = () => {
            if (document.body.contains(overlay)) document.body.removeChild(overlay);
            if (document.body.contains(dialog)) document.body.removeChild(dialog);
        };

        dialog.querySelector('.cnb-issue-btn-cancel').addEventListener('click', close);
        overlay.addEventListener('click', close);
        dialog.querySelector('.cnb-issue-btn-confirm').addEventListener('click', () => {
            const repo = dialog.querySelector('#cnb-setting-repo').value.trim();
            const token = dialog.querySelector('#cnb-setting-token').value.trim();
            if (repo) {
                CONFIG.repoPath = repo;
                if (typeof GM_setValue === 'function') GM_setValue('repoPath', repo);
            }
            if (token) {
                CONFIG.accessToken = token;
                if (typeof GM_setValue === 'function') GM_setValue('accessToken', token);
            }
            if (typeof GM_notification === 'function') {
                GM_notification({
                    text: '设置已保存',
                    title: 'CNB Issue工具',
                    timeout: 2000
                });
            }
            close();
        });

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);
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
                        if (callback) callback(true);
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
                                    if (callback) callback(true);
                                }
                            },
                            onerror: function() {
                                GM_notification({
                                    text: `Issue已创建，但设置标签时网络错误`,
                                    title: 'CNB Issue工具',
                                    timeout: 5000
                                });
                                if (callback) callback(true);
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

    // 初始化
    function init() {
        // 读取持久化配置
        try {
            if (typeof GM_getValue === 'function') {
                const repo = GM_getValue('repoPath', CONFIG.repoPath);
                const token = GM_getValue('accessToken', CONFIG.accessToken);
                CONFIG.repoPath = repo || CONFIG.repoPath;
                CONFIG.accessToken = token || CONFIG.accessToken;
            }
        } catch (_) {}

        createFloatingButton();
        console.log('CNB Issue区域选择工具 (Markdown版) 已加载 - 版本1.0');
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();