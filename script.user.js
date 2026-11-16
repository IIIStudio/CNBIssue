// ==UserScript==
// @name         CNB Issue 网页内容收藏工具
// @namespace    https://cnb.cool/IIIStudio/Greasemonkey/CNBIssue/
// @version      1.7
// @description  在任意网页上选择页面区域，一键将选中内容从 HTML 转为 Markdown，按"页面信息 + 选择的内容"的格式展示，并可直接通过 CNB 接口创建 Issue。支持链接、图片、代码块/行内代码、标题、列表、表格、引用等常见结构的 Markdown 转换。
// @author       IIIStudio
// @match        *://*/*
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.cnb.cool
// @connect      cnb.cool
// @connect      api.cnb.build
// @connect      cnb.build
// @connect      *
// @connect      weibo.com
// @connect      *.weibo.com
// @connect      sinaimg.cn
// @connect      *.sinaimg.cn
// @connect      tvax*.sinaimg.cn
// @connect      tva*.sinaimg.cn
// @connect      wx*.sinaimg.cn
// @connect      hb*.sinaimg.cn
// @connect      cdn3.ldstatic.com
// @connect      *.ldstatic.com
// @connect      ldstatic.com
// @license MIT
// ==/UserScript==

(function() {
    'use strict';

    // 样式注入防重标记
    const __CNB_FLAGS = Object.create(null);

    // 只注入一次样式：优先 GM_addStyle，缺失时回退到 <style>
    function addStyleOnce(key, cssText) {
        if (__CNB_FLAGS[key]) return;
        __CNB_FLAGS[key] = 1;
        try {
            if (typeof GM_addStyle === 'function') {
                GM_addStyle(cssText);
                return;
            }
            const style = document.createElement('style');
            style.textContent = cssText;
            (document.head || document.documentElement).appendChild(style);
        } catch (_) {}
    }
    // 运行期共享状态
    const state = {
        selecting: false,
        selectedElement: null,
        selectedElements: new Set(),
        lastSelectedElement: null
    };

    // 筛选标签按钮样式（创建弹窗与 Issue 列表共用，胶囊风格）
    const CNB_FILTER_BTN_CSS = `
        .cnb-issue-dialog .cnb-issue-filter { display:flex !important; flex-wrap:wrap !important; gap:4px !important; }
        .cnb-issue-dialog .cnb-issue-filter .cnb-issue-filter-btn {
            display: inline-flex !important;
            align-items: center !important;
            gap: 4px !important;
            margin: 0 !important;
            padding: 2px 8px !important;
            border: 1px solid #d0d7de !important;
            border-radius: 9999px !important;
            background: #fff !important;
            color: #24292f !important;
            font-size: 12px !important;
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
    `;

    // Issue 列表行内标签胶囊 / 附件行样式
    const CNB_COMMON_CSS = `
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
        .cnb-issue-chip:hover { background: #000; color: #fff; }
        .cnb-issue-dialog .cnb-attach-row {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            margin: 2px 0;
        }
    `;

    // 首次注入公共样式（筛选按钮 + 标签胶囊 + 附件行）
    function injectCommonStyles() {
        addStyleOnce('common-css', CNB_FILTER_BTN_CSS + CNB_COMMON_CSS);
    }

    // 配置信息
    const CONFIG = {
        region: 'cn',                       // 'cn' = 国内, 'abroad' = 国外
        apiBase: 'https://api.cnb.cool',    // 由当前区域决定
        webBase: 'https://cnb.cool',        // 由当前区域决定
        repoPath: '',
        accessToken: '',
        issueEndpoint: '/-/issues',
        uploadEnabled: true,
        uploadFilesEnabled: true
    };

    // 服务器区域：国内 / 国外，各自使用独立的 API、站点与仓库/令牌配置
    const REGIONS = {
        cn: {
            label: '国内',
            apiBase: 'https://api.cnb.cool',
            webBase: 'https://cnb.cool',
            repoKey: 'repoPath',
            tokenKey: 'accessToken',
            clipKey: 'cnbClipboardIssue',
            favKey: 'cnbFavIssue',
            clipTitlesKey: 'cnbClipboardIssueTitles'
        },
        abroad: {
            label: '国外',
            apiBase: 'https://api.cnb.build',
            webBase: 'https://cnb.build',
            repoKey: 'repoPathAbroad',
            tokenKey: 'accessTokenAbroad',
            clipKey: 'cnbClipboardIssueAbroad',
            favKey: 'cnbFavIssueAbroad',
            clipTitlesKey: 'cnbClipboardIssueTitlesAbroad'
        }
    };

    function currentRegion() {
        return REGIONS[CONFIG.region] || REGIONS.cn;
    }

    function regionLabel() {
        return currentRegion().label;
    }

    // 应用区域：切换 API/站点地址，并读取该区域对应的仓库与令牌
    function applyRegion(region, persist) {
        const key = REGIONS[region] ? region : 'cn';
        const r = REGIONS[key];
        CONFIG.region = key;
        CONFIG.apiBase = r.apiBase;
        CONFIG.webBase = r.webBase;
        try {
            if (typeof GM_getValue === 'function') {
                CONFIG.repoPath = GM_getValue(r.repoKey, '') || '';
                CONFIG.accessToken = GM_getValue(r.tokenKey, '') || '';
            }
        } catch (_) {}
        if (persist && typeof GM_setValue === 'function') {
            try { GM_setValue('cnbRegion', key); } catch (_) {}
        }
    }

    // 切换区域：国内 <-> 国外
    function switchRegion() {
        const next = (CONFIG.region === 'abroad') ? 'cn' : 'abroad';
        applyRegion(next, true);
        try {
            const btn = document.getElementById('cnb-btn-region');
            if (btn) btn.textContent = regionLabel();
        } catch (_) {}
        // 同步刷新设置弹窗（仓库/令牌/标签/剪贴板/收藏）与 Dock 剪贴板按钮
        try {
            const settings = DIALOG.settings;
            if (settings && typeof settings.refresh === 'function') settings.refresh();
        } catch (_) {}
        try { syncDockClipboardButton(); } catch (_) {}
        try { notifyUser('已切换到' + regionLabel() + '服务器', 2000); } catch (_) {}
        return next;
    }
    let SAVED_TAGS = [];
    // 选择模式快捷键（可在设置中修改），规范格式如：Shift+E
    let START_HOTKEY = 'Shift+E';
    let HOTKEY_ENABLED = false;

    // 添加自定义样式 - 扁平黑白配色
    function injectStyles() {
        // 弹窗 / 选择模式 / 加载动画
        addStyleOnce('base-dialog', `
        .cnb-issue-dialog {
            position: fixed !important;
            top: 50% !important;
            left: 50% !important;
            transform: translate(-50%, -50%) !important;
            background: #fff !important;
            border: 2px solid #000 !important;
            border-radius: 0 !important;
            padding: 10px 12px !important;
            z-index: 2147483641 !important;
            box-shadow: 4px 4px 0 #000 !important;
            min-width: 500px !important;
            max-width: 90vw !important;
            max-height: 80vh !important;
            overflow: auto !important;
        }
        .cnb-issue-dialog h3 {
            margin: 0 0 6px 0;
            color: #000;
            font-size: 14px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .cnb-issue-dialog textarea {
            width: 100%;
            height: 200px;
            margin: 4px 0;
            padding: 8px;
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
            margin: 4px 0;
            padding: 6px 8px;
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
            gap: 6px;
            margin-top: 8px;
        }
        .cnb-issue-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.7);
            z-index: 2147483640;
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
            z-index: 2147483643;
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

        // Dock / Toast
        addStyleOnce('base-dock', `
        .cnb-dock {
            position: fixed !important;
            left: -200px !important;
            right: auto !important;
            top: 40% !important;
            bottom: auto !important;
            margin: 0 !important;
            transform: none !important;
            float: none !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 4px !important;
            padding: 4px 4px 4px 8px !important;
            background: #fff !important;
            border: 2px solid #000 !important;
            border-left: none !important;
            border-radius: 0 !important;
            box-shadow: 3px 3px 0 #000 !important;
            z-index: 2147483642 !important;
            transition: left .15s ease, opacity .15s ease !important;
            opacity: 0.9;
            /* 隐藏态：完全不可见、不拦截鼠标事件，避免误触发或被站点样式挤到页面中间 */
            visibility: hidden;
            pointer-events: none;
        }
        .cnb-dock:hover,
        .cnb-dock.cnb-dock--visible {
            left: 0 !important;
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
        }
        .cnb-dock .cnb-dock-btn {
            position: static !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            min-width: 54px !important;
            height: 28px !important;
            margin: 0 !important;
            padding: 0 8px !important;
            font-size: 12px !important;
            font-weight: 600 !important;
            color: #000 !important;
            background: #fff !important;
            border: 2px solid #000 !important;
            border-radius: 0 !important;
            box-sizing: border-box !important;
            cursor: pointer !important;
            transition: all 0.1s ease !important;
        }
        .cnb-dock .cnb-dock-btn:hover {
            background: #000;
            color: #fff;
        }
        .cnb-dock .cnb-dock-btn:active {
            transform: translate(1px, 1px);
        }

        /* 右下角结果提示（Toast）：显示后向右滑出消失 */
        .cnb-toast {
            position: fixed !important;
            right: 16px !important;
            bottom: 16px !important;
            left: auto !important;
            top: auto !important;
            z-index: 2147483646 !important;
            display: block !important;
            visibility: visible !important;
            pointer-events: auto !important;
            max-width: 320px !important;
            padding: 10px 14px !important;
            background: #fff !important;
            color: #000 !important;
            border: 2px solid #000 !important;
            border-radius: 0 !important;
            box-shadow: 4px 4px 0 #000 !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important;
            font-size: 13px !important;
            font-weight: 400 !important;
            line-height: 1.5 !important;
            word-break: break-word !important;
            cursor: pointer !important;
            transform: translateX(120%) !important;
            opacity: 0 !important;
            transition: transform .28s ease, opacity .28s ease !important;
        }
        .cnb-toast.cnb-toast--show {
            transform: translateX(0) !important;
            opacity: 1 !important;
        }
        .cnb-toast.cnb-toast--hide {
            transform: translateX(120%) !important;
            opacity: 0 !important;
        }
        .cnb-toast .cnb-toast-title {
            font-weight: 700 !important;
        }
        .cnb-toast a.cnb-toast-link {
            color: #000 !important;
            text-decoration: underline !important;
            cursor: pointer !important;
        }
        .cnb-toast a.cnb-toast-link:hover {
            color: #666 !important;
        }
    `);

        // 控件重置 / 开关 / 滚动条
        addStyleOnce('base-controls', `
        /* 对话框内全局样式重置 */
        .cnb-issue-dialog,
        .cnb-issue-dialog * {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important;
            text-align: left !important;
            letter-spacing: normal !important;
            word-spacing: normal !important;
        }

        /* 对话框内标签统一字号 */
        .cnb-issue-dialog label {
            font-size: 13px !important;
        }

        .cnb-issue-dialog input.cnb-control,
        .cnb-issue-dialog textarea.cnb-control {
            box-sizing: border-box !important;
            width: 100% !important;
            margin: 4px 0 !important;
            padding: 5px 10px !important;
            border: 2px solid #000 !important;
            border-radius: 0 !important;
            background: #fff !important;
            color: #000 !important;
            font: normal 13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Helvetica,Arial,"PingFang SC","Microsoft Yahei",sans-serif !important;
            outline: none !important;
            appearance: none !important;
            -webkit-appearance: none !important;
            -moz-appearance: none !important;
            transition: all 0.1s ease !important;
            height: 30px !important;
        }
        .cnb-issue-dialog textarea.cnb-control {
            min-height: 180px !important;
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
            padding: 4px 12px !important;
            border: 2px solid #000 !important;
            border-radius: 0 !important;
            cursor: pointer !important;
            font-size: 13px !important;
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
        #cnb-issue-tags { margin-top: 2px !important; }
        .cnb-tag-btn {
            margin: 2px !important;
            padding: 0 6px !important;
            border: 2px solid #000 !important;
            border-radius: 0 !important;
            background: #fff !important;
            color: #000 !important;
            font-size: 12px !important;
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
        .cnb-tags-list { margin-top: 4px !important; }
        .cnb-tag-pill {
            display: inline-flex !important;
            align-items: center !important;
            gap: 4px !important;
            margin: 2px !important;
            padding: 0 6px !important;
            border: 2px solid #000 !important;
            border-radius: 0 !important;
            background: #fff !important;
            color: #000 !important;
            font-size: 12px !important;
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
            font-size: 14px !important;
            font-weight: 700 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            height: 16px !important;
            padding: 0 4px !important;
            line-height: 16px !important;
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
            gap: 6px !important;
            align-items: center !important;
            flex-wrap: nowrap !important;
        }
        .cnb-tag-addbtn, .cnb-tag-fetchbtn {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            white-space: nowrap !important;
            height: 30px !important;
            padding: 0 12px !important;
            box-sizing: border-box !important;
            border-radius: 0 !important;
            border: 2px solid #000 !important;
            background: #000 !important;
            color: #fff !important;
            cursor: pointer !important;
            font-size: 13px !important;
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
            height: 30px !important;
            flex: 1 1 auto !important;
        }

        /* 提示文本 */
        .cnb-hint {
            color: #666 !important;
            font-size: 12px !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important;
            font-weight: 400 !important;
            line-height: 1.4 !important;
            text-align: left !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        /* 设置页：标题与项目超链接（并排显示）- 扁平黑白配色 */
        .cnb-settings-header {
            display: flex !important;
            align-items: center !important;
            flex-wrap: wrap !important;
            gap: 8px !important;
            margin: 0 0 6px 0 !important;
            padding-right: 24px !important;
        }
        .cnb-settings-header h3 { margin: 0 !important; }
        .cnb-settings-links-row {
            display: inline-flex !important;
            flex-wrap: wrap !important;
            gap: 6px !important;
        }
        .cnb-issue-dialog a.cnb-link-btn {
            display: inline !important;
            padding: 0 !important;
            border: none !important;
            background: transparent !important;
            color: #000 !important;
            font-size: 12px !important;
            font-weight: 600 !important;
            line-height: 1 !important;
            text-decoration: none !important;
            cursor: pointer !important;
            transition: color 0.1s ease !important;
        }
        .cnb-issue-dialog a.cnb-link-btn:hover {
            color: #666 !important;
            text-decoration: underline !important;
        }
        /* 设置页标题右侧：区域切换开关 */
        .cnb-issue-dialog .cnb-region-toggle {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            height: 22px !important;
            padding: 0 8px !important;
            box-sizing: border-box !important;
            border: 2px solid #000 !important;
            border-radius: 0 !important;
            background: #000 !important;
            color: #fff !important;
            font-size: 12px !important;
            font-weight: 600 !important;
            line-height: 1 !important;
            cursor: pointer !important;
            transition: all 0.1s ease !important;
        }
        .cnb-issue-dialog .cnb-region-toggle:hover {
            background: #fff !important;
            color: #000 !important;
        }

        /* 图片上传开关容器 */
        .cnb-image-upload-toggle {
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            margin-top: 2px !important;
        }

        /* 开关样式 - 扁平黑白配色 */
        .cnb-toggle-switch {
            position: relative !important;
            display: inline-block !important;
            width: 40px !important;
            height: 22px !important;
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
            height: 12px !important;
            width: 12px !important;
            left: 3px !important;
            bottom: 3px !important;
            background-color: #000 !important;
            transition: .15s !important;
            border-radius: 0 !important;
        }

        .cnb-toggle-switch input:checked + .cnb-toggle-slider {
            background-color: #000 !important;
        }

        .cnb-toggle-switch input:checked + .cnb-toggle-slider:before {
            transform: translateX(18px) !important;
            background-color: #fff !important;
        }

        /* Issue号输入框样式 - 覆盖全局的 width: 100% */
        .cnb-issue-dialog input.cnb-issue-number-input {
            width: 90px !important;
            margin-left: 8px !important;
            height: 28px !important;
        }

        /* 开关样式（无文字，仅图形） - 扁平黑白配色 */
        .cnb-switch {
            position: relative !important;
            display: inline-block !important;
            width: 36px !important;
            height: 20px !important;
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
            left: 3px !important;
            top: 3px !important;
            width: 10px !important;
            height: 10px !important;
            background: #000 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            transition: transform .15s ease !important;
        }
        .cnb-switch input:checked + .cnb-switch-slider {
            background: #000 !important;
        }
        .cnb-switch input:checked + .cnb-switch-slider::before {
            transform: translateX(16px) !important;
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
    }

    // HTML转Markdown的转换器
    const htmlToMarkdown = {
        // 图片收集列表
        images: [],

        // 转换入口函数：返回 { markdown, images }，避免调用方依赖实例状态
        convert: function(html) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;

            this.images = [];
            this.cleanUnwantedElements(tempDiv);
            const markdown = this.processNode(tempDiv).trim();

            return { markdown, images: this.images };
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

        // 将相对 URL 解析为绝对 URL（基于原页面地址），避免相对链接在 CNB Issue 中
        // 被错误地解析为 CNB 仓库路径（如 /uploads/xxx.zip -> cnb.cool/<repo>/-/git/raw/HEAD/...）
        resolveUrl: function(url) {
            if (!url) return '';
            const value = String(url).trim();
            if (!value) return value;
            // 纯锚点保持原样（避免解析成当前页面的绝对地址）
            if (value.startsWith('#')) return value;
            // 已带协议（http:, https:, mailto:, javascript:, data:, blob: 等）直接返回
            if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value;
            try {
                return new URL(value, document.baseURI || location.href).href;
            } catch (_) {
                return value;
            }
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
                    const href = this.resolveUrl(node.getAttribute('href'));
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
                    const alt = node.getAttribute('alt') || '';
                    // 优先获取父元素 <a> 标签的原始图片 URL（不受类名限制）
                    let src = this.resolveUrl(node.getAttribute('src'));
                    const parentHref = (() => {
                        const parent = node.parentElement;
                        if (parent && parent.tagName === 'A') {
                            const href = this.resolveUrl(parent.getAttribute('href'));
                            // 检查 href 是否指向图片
                            if (/\.(webp|jpe?g|png|gif|svg|bmp|ico)(\?.*)?$/i.test(href)) {
                                return href;
                            }
                        }
                        return null;
                    })();
                    if (parentHref) {
                        src = parentHref;
                    }
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
        if (!state.selecting && matchesHotkey(e, START_HOTKEY)) {
            e.preventDefault();
            startAreaSelection();
        }
    }

    // 根据当前区域配置的“剪贴板位置”同步 Dock 上的“剪贴板”按钮
    function syncDockClipboardButton() {
        const dock = document.querySelector('.cnb-dock');
        if (!dock) return;
        let clipIssue = '';
        try {
            if (typeof GM_getValue === 'function') clipIssue = String(GM_getValue(currentRegion().clipKey, '') || '').trim();
        } catch (_) {}
        let btn = dock.querySelector('#cnb-btn-clipboard');
        if (clipIssue) {
            if (!btn) {
                btn = document.createElement('button');
                btn.id = 'cnb-btn-clipboard';
                btn.className = 'cnb-dock-btn';
                btn.textContent = '剪贴板';
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (typeof openClipboardWindow === 'function') openClipboardWindow();
                });
                dock.appendChild(btn);
            }
        } else if (btn) {
            btn.remove();
        }
    }

    // 创建左侧贴边 Dock
    function createFloatingButton() {
        const dock = document.createElement('div');
        dock.className = 'cnb-dock';

        const addButton = (label, onClick) => {
            const btn = document.createElement('button');
            btn.className = 'cnb-dock-btn';
            btn.textContent = label;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                onClick();
            });
            dock.appendChild(btn);
            return btn;
        };

        addButton('选择', startAreaSelection);
        addButton('设置', openSettingsDialog);
        addButton('列表', openIssueList);

        document.body.appendChild(dock);

        // 剪贴板按钮：根据当前区域的「剪贴板位置」决定是否显示
        syncDockClipboardButton();

        // 仅当鼠标移动到浏览器最左侧极窄边缘（且位于 dock 垂直范围内）时才显示。
        // 使用 mousemove 而非给热区绑定 mouseenter：热区只要光标在其上方就会触发，
        // 导致页面中的小窗口/浮层恰好出现在光标下方时被误触发。
        const DOCK_EDGE_PX = 3;
        let showTimer = null;
        const cancelShow = () => {
            if (!showTimer) return;
            clearTimeout(showTimer);
            showTimer = null;
        };

        document.addEventListener('mousemove', (e) => {
            if (e.clientX > DOCK_EDGE_PX) {
                cancelShow();
                return;
            }

            // 仅在 dock 所在的垂直范围内触发
            const rect = dock.getBoundingClientRect();
            if (e.clientY < rect.top || e.clientY > rect.bottom) return;
            if (dock.classList.contains('cnb-dock--visible') || showTimer) return;

            // 延迟 300ms 显示，避免过于敏感
            showTimer = setTimeout(() => {
                showTimer = null;
                dock.classList.add('cnb-dock--visible');
            }, 300);
        }, true);

        dock.addEventListener('mouseenter', () => {
            cancelShow();
            dock.classList.add('cnb-dock--visible');
        });

        dock.addEventListener('mouseleave', () => {
            dock.classList.remove('cnb-dock--visible');
        });

        // 点击 dock 之外的地方时隐藏
        document.addEventListener('click', (e) => {
            if (!dock.contains(e.target)) dock.classList.remove('cnb-dock--visible');
        }, true);

        return dock;
    }

    // 开始区域选择模式
    function startAreaSelection() {
        if (state.selecting) return;

        state.selecting = true;
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
            if (state.selectedElements && state.selectedElements.size > 0) {
                showIssueDialog(Array.from(state.selectedElements));
            } else {
                GM_notification({
                    text: '请先选择区域（支持 Ctrl+点击多选）',
                    title: 'CNB Issue工具',
                    timeout: 3000
                });
            }
        });

        cancelBtn.addEventListener('click', stopAreaSelection);

        // 添加鼠标移动和点击事件（使用捕获阶段，防止页面 stopPropagation 拦截）
        document.addEventListener('mouseover', handleMouseOver, true);
        document.addEventListener('mouseout', handleMouseOut, true);
        document.addEventListener('click', handleElementClick, true);

        // ESC键取消选择（捕获阶段）
        document.addEventListener('keydown', handleKeyDown, true);
    }

    // 停止区域选择模式
    function stopAreaSelection() {
        state.selecting = false;
        document.body.classList.remove('cnb-selection-mode');

        // 移除提示工具条
        const tooltip = document.getElementById('cnb-selection-tooltip');
        if (tooltip) {
            document.body.removeChild(tooltip);
        }

        // 移除样式（包含已选与悬停高亮）
        if (state.selectedElement) {
            state.selectedElement.classList.remove('cnb-selection-selected');
        }
        const toClear = document.querySelectorAll('.cnb-selection-hover, .cnb-selection-selected');
        toClear.forEach(el => {
            el.classList.remove('cnb-selection-hover');
            el.classList.remove('cnb-selection-selected');
        });
        state.selectedElements = new Set();
        state.lastSelectedElement = null;
        state.selectedElement = null;

        // 移除事件监听（与注册时一致使用捕获阶段）
        document.removeEventListener('mouseover', handleMouseOver, true);
        document.removeEventListener('mouseout', handleMouseOut, true);
        document.removeEventListener('click', handleElementClick, true);
        document.removeEventListener('keydown', handleKeyDown, true);
    }

    // 处理鼠标悬停
    function handleMouseOver(e) {
        if (!state.selecting) return;

        const element = e.target;
        if (!state.selectedElements.has(element) && !element.closest('.cnb-dock')) {
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
        if (!state.selecting) return;

        const element = e.target;
        if (!state.selectedElements.has(element) && element.classList.contains('cnb-selection-hover')) {
            element.classList.remove('cnb-selection-hover');
        }
    }

    // 处理元素点击
    function handleElementClick(e) {
        if (!state.selecting) return;

        e.preventDefault();
        e.stopPropagation();

        const element = e.target;

        // Ctrl 多选：切换该元素选中状态；否则保持单选
        if (e.ctrlKey === true) {
            element.classList.remove('cnb-selection-hover');
            if (state.selectedElements.has(element)) {
                element.classList.remove('cnb-selection-selected');
                state.selectedElements.delete(element);
            } else {
                element.classList.add('cnb-selection-selected');
                state.selectedElements.add(element);
                state.lastSelectedElement = element;
            }
        } else {
            state.selectedElements.forEach(el => el.classList.remove('cnb-selection-selected'));
            state.selectedElements.clear();
            state.selectedElement = element;
            state.selectedElement.classList.remove('cnb-selection-hover');
            state.selectedElement.classList.add('cnb-selection-selected');
            state.selectedElements.add(state.selectedElement);
            state.lastSelectedElement = state.selectedElement;
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
                if (state.selectedElements && state.selectedElements.size > 0) {
                    showIssueDialog(Array.from(state.selectedElements));
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
            if (state.selecting && state.selectedElements && state.selectedElements.size > 0) {
                e.preventDefault();
                showIssueDialog(Array.from(state.selectedElements));
            }
        }
    }

    /* ============================================================
     * 弹窗与表单公共组件
     * 创建 / 修改 / 评论三类操作在此之前各有各的实现，现统一到这里
     * ============================================================ */

    // 弹窗单例注册表：name -> { dialog, overlay, close }
    const DIALOG = Object.create(null);

    function closeModal(name) {
        const entry = DIALOG[name];
        if (!entry) return;
        try { entry.close(); } catch (_) {}
    }

    // 打开模态弹窗（同名弹窗只保留一个）
    function openModal(name, options) {
        const opt = options || {};
        closeModal(name);

        const overlay = document.createElement('div');
        overlay.className = opt.overlayClass || 'cnb-issue-overlay';

        const dialog = document.createElement('div');
        dialog.className = opt.className || 'cnb-issue-dialog';
        if (opt.html) dialog.innerHTML = opt.html;
        if (opt.cssText) dialog.style.cssText = opt.cssText;

        const entry = { name, dialog, overlay };
        entry.close = () => {
            if (DIALOG[name] !== entry) return;
            delete DIALOG[name];
            document.removeEventListener('keydown', entry.onEsc, true);
            try { overlay.remove(); } catch (_) {}
            try { dialog.remove(); } catch (_) {}
            if (typeof opt.onClose === 'function') opt.onClose();
        };
        entry.onEsc = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                entry.close();
            }
        };
        DIALOG[name] = entry;

        if (!opt.noOverlay) document.body.appendChild(overlay);
        document.body.appendChild(dialog);

        if (!opt.noOverlay && opt.closeOnOverlay !== false) overlay.addEventListener('click', entry.close);
        if (opt.escClose) document.addEventListener('keydown', entry.onEsc, true);
        return entry;
    }

    /* -------------------- 配置读写 -------------------- */

    function readSetting(key, fallback) {
        try {
            if (typeof GM_getValue !== 'function') return fallback;
            const v = GM_getValue(key, fallback);
            return v === undefined ? fallback : v;
        } catch (_) {
            return fallback;
        }
    }

    function saveSetting(key, value) {
        try {
            if (typeof GM_setValue === 'function') GM_setValue(key, value);
        } catch (_) {}
    }

    /* -------------------- 表单小工具 -------------------- */

    const MODE_TEXT = {
        create: { confirm: '创建Issue', done: '创建完成Issue', busy: '创建中...' },
        edit: { confirm: '修改Issue', done: '修改并完成', busy: '修改中...' },
        comment: { confirm: '添加评论', done: '添加评论并完成', busy: '添加评论中...' }
    };

    function readComposerMode(editToggle, commentToggle) {
        if (commentToggle && commentToggle.checked) return 'comment';
        if (editToggle && editToggle.checked) return 'edit';
        return 'create';
    }

    // 设置按钮的加载态（保持与原有 loading 图标一致）
    function setButtonBusy(button, text) {
        if (!button) return;
        button.disabled = true;
        button.innerHTML = '<div class="cnb-issue-loading"></div>' + text;
    }

    function setHint(dialog, selector, text) {
        const el = dialog.querySelector(selector);
        if (el) el.textContent = text;
    }

    // 绑定复选框并把状态写入配置
    function bindToggle(dialog, selector, onChange) {
        const el = dialog.querySelector(selector);
        if (!el) return;
        el.addEventListener('change', () => onChange(!!el.checked));
    }

    // 收集弹窗中的表单值
    function readComposerForm(dialog) {
        const pick = (sel) => dialog.querySelector(sel);
        const value = (sel) => {
            const el = pick(sel);
            return el ? el.value : '';
        };
        const checked = (sel, fallback) => {
            const el = pick(sel);
            return el ? !!el.checked : fallback;
        };
        return {
            title: value('#cnb-issue-title'),
            content: value('#cnb-issue-content'),
            issueNumber: String(value('#cnb-issue-number') || '').trim(),
            uploadImages: checked('#cnb-upload-toggle', true),
            uploadFiles: checked('#cnb-file-upload-toggle', true),
            edit: checked('#cnb-edit-toggle', false),
            comment: checked('#cnb-comment-toggle', false)
        };
    }

    /* -------------------- 标签选择器 -------------------- */

    function createTagPicker(container) {
        if (!container) {
            return { clear() {}, set() {}, getSelected: () => [], loadFromIssue() {} };
        }

        let selected = [];

        const buttonOf = (name) => Array.from(container.querySelectorAll('.cnb-tag-btn'))
            .find(btn => btn.textContent === name) || null;

        const clear = () => {
            selected = [];
            container.querySelectorAll('.cnb-tag-btn').forEach(btn => btn.classList.remove('active'));
        };

        const set = (names) => {
            clear();
            (names || []).forEach(name => {
                const btn = buttonOf(name);
                if (!btn) return;
                btn.classList.add('active');
                if (!selected.includes(name)) selected.push(name);
            });
        };

        const loadFromIssue = (issueNumber) => {
            const num = String(issueNumber || '').trim();
            if (!num) {
                clear();
                return;
            }
            fetchIssueLabels(num, (labels, error) => {
                if (error) {
                    console.error('[CNB Issue] 获取标签失败:', error);
                    return;
                }
                set((labels || []).map(label => (label && label.name) || label));
            });
        };

        const render = () => {
            container.innerHTML = '';
            const tags = Array.isArray(SAVED_TAGS) ? SAVED_TAGS : [];
            if (tags.length === 0) {
                const hint = document.createElement('div');
                hint.className = 'cnb-hint';
                hint.textContent = '在设置中添加标签后可在此选择';
                container.appendChild(hint);
                return;
            }
            tags.forEach(tag => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'cnb-tag-btn';
                btn.textContent = tag;
                btn.addEventListener('click', () => {
                    const idx = selected.indexOf(tag);
                    if (idx >= 0) {
                        selected.splice(idx, 1);
                        btn.classList.remove('active');
                    } else {
                        selected.push(tag);
                        btn.classList.add('active');
                    }
                });
                container.appendChild(btn);
            });
        };

        render();
        return { render, clear, set, loadFromIssue, getSelected: () => selected.slice() };
    }

    /* -------------------- 收藏选择器 -------------------- */

    // 解析「评论收藏」配置：1|收藏,5|阅读（兼容中文逗号）
    function parseFavItems(raw) {
        return String(raw || '')
            .split(/[,，]/)
            .map(s => s.trim())
            .filter(Boolean)
            .map(part => {
                const match = part.match(/^(\d+)\|(.+)$/);
                return match ? { issueNumber: match[1], name: match[2].trim() } : null;
            })
            .filter(Boolean);
    }

    function readFavItems() {
        return parseFavItems(readSetting(currentRegion().favKey, ''));
    }

    // 选中收藏项时自动开启「修改 + 评论」并回填该 Issue 的标签
    function createFavPicker(container, ctx) {
        if (!container) return;
        container.innerHTML = '';

        const items = readFavItems();
        if (items.length === 0) {
            const section = container.parentElement;
            if (section) section.style.display = 'none';
            return;
        }

        let activeBtn = null;

        const deactivate = () => {
            activeBtn = null;
            container.querySelectorAll('.cnb-tag-btn').forEach(btn => btn.classList.remove('active'));
            if (ctx.editToggle) ctx.editToggle.checked = false;
            if (ctx.commentToggle) ctx.commentToggle.checked = false;
            ctx.syncEditState();
            ctx.tagPicker.clear();
            ctx.updateButtonText();
        };

        const activate = (btn, item) => {
            container.querySelectorAll('.cnb-tag-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeBtn = btn;
            if (ctx.editToggle) ctx.editToggle.checked = true;
            if (ctx.commentToggle) ctx.commentToggle.checked = true;
            if (ctx.issueNumberInput) ctx.issueNumberInput.value = item.issueNumber;
            ctx.syncEditState();
            ctx.tagPicker.loadFromIssue(item.issueNumber);
            ctx.updateButtonText();
        };

        items.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cnb-tag-btn';
            btn.textContent = item.name;
            btn.addEventListener('click', () => {
                if (btn === activeBtn) deactivate();
                else activate(btn, item);
            });
            container.appendChild(btn);
        });
    }

    /**
     * 绑定创建/修改/评论弹窗中的元信息控件：
     * 编辑开关、评论开关、Issue 号、标签、收藏、按钮文案。
     */
    function mountComposerMeta(dialog) {
        const pick = (sel) => dialog.querySelector(sel);
        const editToggle = pick('#cnb-edit-toggle');
        const commentToggle = pick('#cnb-comment-toggle');
        const issueNumberInput = pick('#cnb-issue-number');
        const confirmBtn = pick('.cnb-issue-btn-confirm');
        const doneBtn = pick('.cnb-issue-btn-done');

        const tagPicker = createTagPicker(pick('#cnb-issue-tags'));

        const syncEditState = () => {
            if (!issueNumberInput) return;
            issueNumberInput.style.display = (editToggle && editToggle.checked) ? 'inline-block' : 'none';
        };

        const updateButtonText = () => {
            const mode = readComposerMode(editToggle, commentToggle);
            if (confirmBtn) confirmBtn.textContent = MODE_TEXT[mode].confirm;
            if (doneBtn) doneBtn.textContent = MODE_TEXT[mode].done;
        };

        if (editToggle) {
            editToggle.addEventListener('change', () => {
                syncEditState();
                if (!editToggle.checked && commentToggle) commentToggle.checked = false;
                updateButtonText();
            });
        }

        if (commentToggle) {
            commentToggle.addEventListener('change', () => {
                // 评论必须依赖编辑开关（决定 Issue 号是否可见）
                if (commentToggle.checked && editToggle && !editToggle.checked) {
                    editToggle.checked = true;
                    syncEditState();
                }
                updateButtonText();
            });
        }

        if (issueNumberInput) {
            issueNumberInput.addEventListener('blur', () => {
                tagPicker.loadFromIssue(issueNumberInput.value.trim());
            });
        }

        createFavPicker(pick('#cnb-issue-fav'), {
            editToggle,
            commentToggle,
            issueNumberInput,
            tagPicker,
            syncEditState,
            updateButtonText
        });

        updateButtonText();

        return {
            tagPicker,
            getMode: () => readComposerMode(editToggle, commentToggle),
            getLabels: () => tagPicker.getSelected(),
            updateButtonText
        };
    }

    /* -------------------- 提交逻辑 -------------------- */

    // 执行创建 / 修改 / 评论；isDone 时额外把 Issue 置为已完成
    function runIssueOperation(opts) {
        const { mode, isDone, title, content, labels, issueNumber, onSuccess, onError } = opts;
        const fail = () => { if (typeof onError === 'function') onError(); };
        const succeed = (message) => {
            if (message) notifyUser(message);
            if (typeof onSuccess === 'function') onSuccess();
        };

        if (mode === 'comment') {
            addCommentToIssue(issueNumber, content, (ok) => {
                if (!ok) return fail();
                if (!isDone) return succeed();
                closeIssue(issueNumber, 'completed', (closed) => {
                    if (!closed) return fail();
                    succeed('评论已添加，Issue已标记为已完成');
                });
            });
            return;
        }

        if (mode === 'edit') {
            const payload = { body: content, title };
            if (isDone) {
                payload.state = 'closed';
                payload.state_reason = 'completed';
            }
            updateIssue(issueNumber, payload, labels, (ok) => {
                if (!ok) return fail();
                if (!isDone) return succeed();
                succeed('Issue已修改并完成');
            });
            return;
        }

        createIssue(title, content, labels, (ok, issueId) => {
            if (!ok) return fail();
            if (!isDone) return succeed();
            if (issueId == null) return fail();
            closeIssue(issueId, 'completed', (closed) => {
                if (!closed) return fail();
                succeed('Issue已标记为已完成（closed: completed）');
            });
        });
    }

    /**
     * 统一的提交入口：校验 -> 按钮加载态 -> prepare（上传/截图） -> 执行操作
     * prepare(form, dialog) 返回处理后的正文内容（可为 Promise）。
     */
    async function submitComposer(opts) {
        const { dialog, close, isDone, meta, prepare, button, otherButton } = opts;
        const form = readComposerForm(dialog);
        const mode = meta.getMode();

        if ((mode === 'edit' || mode === 'comment') && !form.issueNumber) {
            notifyUser('请输入Issue号');
            return;
        }

        const buttons = [button, otherButton].filter(Boolean);
        buttons.forEach(btn => { btn.disabled = true; });
        setButtonBusy(button, isDone ? '处理中...' : MODE_TEXT[mode].busy);

        const restore = () => {
            buttons.forEach(btn => { btn.disabled = false; });
            meta.updateButtonText();
        };

        let content = form.content;
        if (typeof prepare === 'function') {
            try {
                content = await prepare(form, dialog);
            } catch (error) {
                console.error('[CNB Issue] 内容处理失败:', error);
                notifyUser('处理失败：' + ((error && error.message) || error), 5000);
                restore();
                return;
            }
        }

        runIssueOperation({
            mode,
            isDone,
            title: form.title,
            content,
            labels: meta.getLabels(),
            issueNumber: form.issueNumber,
            onError: restore,
            onSuccess: close
        });
    }

    /* -------------------- 附件与图片上传 -------------------- */

    // 本地附件选择列表
    function setupAttachmentPicker(dialog, localFiles) {
        const pickBtn = dialog.querySelector('#cnb-attach-pick');
        const input = dialog.querySelector('#cnb-attach-input');
        const listEl = dialog.querySelector('#cnb-attach-list');
        if (!pickBtn || !input || !listEl) return;

        const render = () => {
            listEl.innerHTML = '';
            localFiles.forEach((file, index) => {
                const row = document.createElement('div');
                row.className = 'cnb-attach-row';

                const name = document.createElement('span');
                name.textContent = `${file.name} (${formatFileSize(file.blob.size)})`;

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'cnb-tag-btn';
                removeBtn.textContent = '移除';
                removeBtn.addEventListener('click', () => {
                    localFiles.splice(index, 1);
                    render();
                });

                row.appendChild(name);
                row.appendChild(removeBtn);
                listEl.appendChild(row);
            });
        };

        pickBtn.addEventListener('click', () => input.click());
        input.addEventListener('change', () => {
            Array.from(input.files || []).forEach(file => {
                localFiles.push({ name: file.name, blob: file });
            });
            input.value = '';
            render();
        });
    }

    // 按开关上传正文中的图片与附件（含本地附件），返回处理后的正文
    async function uploadContentAssets(dialog, form, localFiles) {
        let content = form.content;

        const images = form.uploadImages ? extractImagesFromMarkdown(content) : [];
        if (images.length > 0) {
            setHint(dialog, '#cnb-image-upload-status', '正在上传图片...');
            content = await new Promise(resolve => {
                uploadImagesAndReplace(content, images, (updated, errors) => {
                    const failedList = (errors || []).filter(e => e.error);
                    const successCount = (errors || []).length - failedList.length;
                    setHint(dialog, '#cnb-image-upload-status', failedList.length > 0
                        ? `图片上传完成：成功 ${successCount} 张，失败 ${failedList.length} 张`
                        : '图片上传完成');
                    if (failedList.length > 0) console.warn('[CNB Issue] 部分图片上传失败:', failedList);
                    resolve(updated);
                });
            });
        }

        const remoteFiles = form.uploadFiles
            ? extractFileLinksFromMarkdown(content).map(f => ({ name: f.name, href: f.url }))
            : [];
        const entries = remoteFiles.concat(localFiles || []);
        if (entries.length === 0) return content;

        setHint(dialog, '#cnb-file-upload-status', '正在上传附件...');
        return new Promise(resolve => {
            uploadFilesAndReplace(content, entries, (updated, errors) => {
                const failedList = (errors || []).filter(e => e.error);
                const successCount = (errors || []).length - failedList.length;
                setHint(dialog, '#cnb-file-upload-status', failedList.length > 0
                    ? `附件上传完成：成功 ${successCount} 个，失败 ${failedList.length} 个`
                    : '附件上传完成');
                if (failedList.length > 0) {
                    console.error('[CNB Issue] 部分附件上传失败:', failedList);
                    notifyUser('附件上传失败：' + (failedList[0].error || '未知错误'), 8000);
                }
                resolve(updated);
            });
        });
    }

    // 从选中元素批量转换 Markdown，并收集去重后的图片
    function convertElements(elements) {
        const parts = [];
        const images = [];
        const seen = new Set();

        (elements || []).forEach(el => {
            if (!el) return;
            try {
                const result = htmlToMarkdown.convert(el.innerHTML);
                const text = cleanMarkdownContent(result.markdown || '').trim();
                if (text) parts.push(text);
                (result.images || []).forEach(img => {
                    if (seen.has(img.src)) return;
                    seen.add(img.src);
                    images.push(img);
                });
            } catch (error) {
                console.error('[CNB Issue] Markdown 转换失败:', error);
                const fallback = (el.textContent || el.innerText || '').trim();
                if (fallback) parts.push(fallback);
            }
        });

        const markdown = (parts.length > 1 ? '\n' : '') + parts.join('\n\n---\n\n\n');
        return { markdown, images };
    }

    /* -------------------- 微博截图 -------------------- */

    function isWeiboPage() {
        return location.hostname === 'weibo.com' || location.hostname.endsWith('.weibo.com');
    }

    // 按需加载 html2canvas（同一时刻只加载一次）
    function loadHtml2Canvas(onReady) {
        if (typeof html2canvas !== 'undefined') {
            onReady();
            return;
        }
        const existing = document.querySelector('script[data-cnb-html2canvas]');
        if (existing) {
            existing.addEventListener('load', onReady, { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        script.dataset.cnbHtml2canvas = '1';
        script.onload = onReady;
        script.onerror = () => notifyUser('html2canvas 库加载失败');
        document.head.appendChild(script);
    }

    // 从选中区域提取微博出处信息
    function extractWeiboSource(elements, pageUrl, pageTitle) {
        let sourceUrl = pageUrl;
        let sourceTime = new Date().toLocaleString();

        for (const el of elements) {
            const timeLink = el.querySelector('a[class*="_time"]');
            if (timeLink && timeLink.href) {
                sourceUrl = timeLink.href;
                if (timeLink.title) sourceTime = timeLink.title;
                break;
            }
        }

        let title = pageTitle.replace(/\s*-\s*.+$/, '').replace(/\s+/g, ' ');
        const textEl = elements[0] && elements[0].querySelector('[class*="_wbtext"]');
        if (textEl) {
            const text = textEl.textContent.trim();
            title = text.length > 100 ? text.slice(0, 100) + '...' : text;
        }
        return { title, sourceUrl, sourceTime };
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
            reader.readAsDataURL(blob);
        });
    }

    // 用页面自身的 Referer 抓取图片并转成 dataURL，避免截图时跨域空白
    function fetchImageAsDataUrl(url) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'blob',
                headers: { 'Referer': location.href },
                onload: (response) => {
                    const blob = response && response.response;
                    if (!blob || !(blob instanceof Blob)) {
                        resolve(null);
                        return;
                    }
                    blobToDataUrl(blob).then(resolve).catch(() => resolve(null));
                },
                onerror: () => resolve(null)
            });
        });
    }

    // 预加载选中区域内的所有图片
    function preloadImages(elements) {
        const jobs = [];
        (elements || []).forEach(el => {
            el.querySelectorAll('img').forEach(img => {
                if (!img.src || img.src.startsWith('data:')) return;
                jobs.push(fetchImageAsDataUrl(img.src).then(dataUrl => {
                    if (dataUrl) img.src = dataUrl;
                }));
            });
        });
        return Promise.all(jobs);
    }

    // 把选中元素截图为 PNG Blob（无论成功失败都会恢复临时样式）
    async function captureElementsToBlob(elements) {
        if (typeof html2canvas !== 'function') throw new Error('html2canvas 未就绪');

        const bounds = elements.map(el => el.getBoundingClientRect());
        const x = Math.min(...bounds.map(b => b.left)) - 10;
        const y = Math.min(...bounds.map(b => b.top)) - 10;
        const width = Math.max(...bounds.map(b => b.right)) + 10 - x;
        const height = Math.max(...bounds.map(b => b.bottom)) + 10 - y;

        const savedStyles = elements.map(el => ({
            el,
            outline: el.style.outline,
            boxShadow: el.style.boxShadow
        }));
        elements.forEach(el => {
            el.style.outline = 'none';
            el.style.boxShadow = 'none';
        });

        try {
            await preloadImages(elements);
            // 等待图片替换后重新渲染
            await new Promise(resolve => setTimeout(resolve, 500));

            const canvas = await html2canvas(document.body, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                allowTaint: true,
                logging: false,
                x,
                y,
                width,
                height,
                ignoreElements: el => !!(el.closest && el.closest('.cnb-issue-dialog, .cnb-issue-overlay'))
            });

            return await new Promise((resolve, reject) => {
                canvas.toBlob(blob => {
                    if (blob) resolve(blob);
                    else reject(new Error('截图生成失败'));
                }, 'image/png');
            });
        } finally {
            savedStyles.forEach(item => {
                item.el.style.outline = item.outline;
                item.el.style.boxShadow = item.boxShadow;
            });
        }
    }

    // 上传 Blob 并返回可访问链接（kind: 'imgs' | 'files'）
    function uploadBlobWithToken(kind, blob, fileName) {
        return new Promise((resolve, reject) => {
            requestAssetUploadToken(kind, fileName, blob.size, (uploadInfo, tokenError) => {
                if (tokenError || !uploadInfo) {
                    reject(new Error(tokenError || '获取上传凭证失败'));
                    return;
                }
                uploadBlobToOss(uploadInfo, blob, kind === 'files' ? '附件' : '图片', (url, uploadError) => {
                    if (uploadError || !url) reject(new Error(uploadError || '上传失败'));
                    else resolve(url);
                });
            });
        });
    }

    /* -------------------- 对话窗结构 -------------------- */

    function buildCreateDialogHtml(ctx) {
        const { pageTitle, pageUrl, selectedContent, imageCount, fileCount } = ctx;
        const now = new Date().toLocaleString();

        const imageToggle = imageCount > 0 ? `
                <div class="cnb-image-upload-toggle">
                    <label class="cnb-toggle-switch">
                        <input type="checkbox" id="cnb-upload-toggle" ${CONFIG.uploadEnabled ? 'checked' : ''}>
                        <span class="cnb-toggle-slider"></span>
                    </label>
                    <div class="cnb-hint" id="cnb-image-upload-status">检测到 ${imageCount} 张图片，点击创建时将自动上传</div>
                </div>` : '';

        const fileToggle = fileCount > 0 ? `
                    <div class="cnb-image-upload-toggle" style="margin-top: 4px;">
                        <label class="cnb-toggle-switch">
                            <input type="checkbox" id="cnb-file-upload-toggle" ${CONFIG.uploadFilesEnabled ? 'checked' : ''}>
                            <span class="cnb-toggle-slider"></span>
                        </label>
                        <div class="cnb-hint" id="cnb-file-upload-status">检测到 ${fileCount} 个附件链接，点击创建时将自动上传</div>
                    </div>` : '';

        return `
            <h3>创建 CNB Issue (Markdown格式)</h3>
            <div>
                <label>标题:</label>
                <input class="cnb-control" type="text" id="cnb-issue-title" value="${escapeHtml(pageTitle)}" placeholder="输入Issue标题">
            </div>
            <div>
                <label>Markdown内容:</label>
                <textarea class="cnb-control" id="cnb-issue-content" placeholder="Markdown内容将自动生成">## 出处：${escapeHtml(pageTitle)}
**URL:** ${escapeHtml(pageUrl)}
**选择时间:** ${now}
${escapeHtml(selectedContent)}</textarea>
                ${imageToggle}
                <div style="margin-top: 6px;">
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <button type="button" class="cnb-tag-btn" id="cnb-attach-pick">添加附件</button>
                        <input type="file" id="cnb-attach-input" multiple style="display: none;">
                        <span class="cnb-hint">可添加本地文件（如 zip），创建 Issue / 评论时自动上传并插入链接</span>
                    </div>
                    <div id="cnb-attach-list" style="margin-top: 4px;"></div>
                    ${fileToggle}
                </div>
                <div style="display: flex; align-items: center; gap: 12px; margin-top: 6px;">
                    <div class="cnb-image-upload-toggle" style="margin: 0;">
                        <label class="cnb-toggle-switch">
                            <input type="checkbox" id="cnb-edit-toggle">
                            <span class="cnb-toggle-slider"></span>
                        </label>
                        <span class="cnb-hint" style="margin-right: 8px;">修改Issue</span>
                        <input class="cnb-control cnb-issue-number-input" type="number" id="cnb-issue-number" placeholder="Issue号" style="width: 80px; display: none; margin-left: 8px;">
                    </div>
                    <div class="cnb-image-upload-toggle" style="margin: 0;">
                        <label class="cnb-toggle-switch">
                            <input type="checkbox" id="cnb-comment-toggle">
                            <span class="cnb-toggle-slider"></span>
                        </label>
                        <span class="cnb-hint" style="margin-right: 8px;">添加评论</span>
                    </div>
                </div>
            </div>
            <div>
                <label>收藏:</label>
                <div id="cnb-issue-fav"></div>
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
    }

    function buildWeiboDialogHtml(info) {
        return `
            <h3>创建 CNB Issue (微博截图)</h3>
            <div>
                <label>标题:</label>
                <input class="cnb-control" type="text" id="cnb-issue-title" value="${escapeHtml(info.title)}" placeholder="输入Issue标题">
            </div>
            <div>
                <label>出处信息:</label>
                <textarea class="cnb-control" id="cnb-issue-content" readonly style="height: 120px;">## 出处：${escapeHtml(info.title)}
**URL:** ${escapeHtml(info.sourceUrl)}
**选择时间:** ${info.sourceTime}
下面是生成的图片</textarea>
                <div class="cnb-hint" id="cnb-capture-status">点击创建时将自动生成并上传截图</div>
            </div>
            <div>
                <label>收藏:</label>
                <div id="cnb-issue-fav"></div>
            </div>
            <div>
                <label>标签:</label>
                <div id="cnb-issue-tags"></div>
            </div>
            <div class="cnb-image-upload-toggle" style="margin-top: 4px;">
                <label class="cnb-toggle-switch">
                    <input type="checkbox" id="cnb-edit-toggle">
                    <span class="cnb-toggle-slider"></span>
                </label>
                <span class="cnb-hint" style="margin-right: 8px;">修改Issue</span>
                <input class="cnb-control cnb-issue-number-input" type="number" id="cnb-issue-number" placeholder="Issue号" style="width: 80px; display: none; margin-left: 8px;">
                <label class="cnb-toggle-switch" style="margin-left: 12px;">
                    <input type="checkbox" id="cnb-comment-toggle">
                    <span class="cnb-toggle-slider"></span>
                </label>
                <span class="cnb-hint">添加评论</span>
            </div>
            <div class="cnb-issue-dialog-buttons">
                <button class="cnb-issue-btn-cancel">取消</button>
                <button class="cnb-issue-btn-done">创建完成Issue</button>
                <button class="cnb-issue-btn-confirm">创建Issue</button>
            </div>
        `;
    }

    // 显示创建Issue的对话框
    function showIssueDialog(selected) {
        stopAreaSelection(); // 先退出选择模式

        const elements = Array.isArray(selected) ? selected.filter(Boolean) : (selected ? [selected] : []);
        const pageTitle = document.title.replace(/\s+-\s+.+$/, '').replace(/\s+/g, ' ');
        const pageUrl = window.location.href;

        // 微博：改为截图模式
        if (isWeiboPage() && elements.length > 0) {
            handleWeiboSelection(elements, pageUrl, pageTitle);
            return;
        }

        const { markdown: selectedContent, images } = convertElements(elements);
        const detectedFiles = extractFileLinksFromMarkdown(selectedContent);

        const modal = openModal('create', {
            html: buildCreateDialogHtml({
                pageTitle,
                pageUrl,
                selectedContent,
                imageCount: images.length,
                fileCount: detectedFiles.length
            })
        });
        const { dialog, close } = modal;

        // 上传开关状态持久化
        bindToggle(dialog, '#cnb-upload-toggle', checked => {
            CONFIG.uploadEnabled = checked;
            saveSetting('cnbUploadEnabled', checked);
        });
        bindToggle(dialog, '#cnb-file-upload-toggle', checked => {
            CONFIG.uploadFilesEnabled = checked;
            saveSetting('cnbUploadFilesEnabled', checked);
        });

        const localFiles = [];
        setupAttachmentPicker(dialog, localFiles);

        const meta = mountComposerMeta(dialog);
        const confirmBtn = dialog.querySelector('.cnb-issue-btn-confirm');
        const doneBtn = dialog.querySelector('.cnb-issue-btn-done');
        dialog.querySelector('.cnb-issue-btn-cancel').addEventListener('click', close);

        const prepare = (form) => uploadContentAssets(dialog, form, localFiles);

        confirmBtn.addEventListener('click', () => submitComposer({
            dialog, close, isDone: false, meta, prepare,
            button: confirmBtn, otherButton: doneBtn
        }));

        if (doneBtn) {
            doneBtn.addEventListener('click', () => submitComposer({
                dialog, close, isDone: true, meta, prepare,
                button: doneBtn, otherButton: confirmBtn
            }));
        }

        const titleInput = dialog.querySelector('#cnb-issue-title');
        if (titleInput) {
            titleInput.focus();
            titleInput.select();
        }
    }

    // 微博选择：截图并创建 Issue
    function handleWeiboSelection(elements, pageUrl, pageTitle) {
        loadHtml2Canvas(() => openWeiboDialog(elements, pageUrl, pageTitle));
    }

    function openWeiboDialog(elements, pageUrl, pageTitle) {
        const info = extractWeiboSource(elements, pageUrl, pageTitle);
        const modal = openModal('create', { html: buildWeiboDialogHtml(info) });
        const { dialog, close } = modal;

        const meta = mountComposerMeta(dialog);
        const confirmBtn = dialog.querySelector('.cnb-issue-btn-confirm');
        const doneBtn = dialog.querySelector('.cnb-issue-btn-done');
        dialog.querySelector('.cnb-issue-btn-cancel').addEventListener('click', close);

        const prepare = async (form) => {
            setHint(dialog, '#cnb-capture-status', '正在生成截图...');
            const blob = await captureElementsToBlob(elements);
            setHint(dialog, '#cnb-capture-status', '正在上传截图...');
            const imageUrl = await uploadBlobWithToken('imgs', blob, `weibo_${Date.now()}.png`);
            setHint(dialog, '#cnb-capture-status', '截图已上传，正在提交...');
            return `${form.content}\n\n![微博截图](${imageUrl})`;
        };

        confirmBtn.addEventListener('click', () => submitComposer({
            dialog, close, isDone: false, meta, prepare,
            button: confirmBtn, otherButton: doneBtn
        }));

        if (doneBtn) {
            doneBtn.addEventListener('click', () => submitComposer({
                dialog, close, isDone: true, meta, prepare,
                button: doneBtn, otherButton: confirmBtn
            }));
        }

        const titleInput = dialog.querySelector('#cnb-issue-title');
        if (titleInput) {
            titleInput.focus();
            titleInput.select();
        }
    }
    // 清理 Markdown：删除表情图片、空引用行与多余空行
    function cleanMarkdownContent(markdown) {
        let out = String(markdown == null ? '' : markdown);
        // 删除表情图片（以 ![:grimacing:] 格式）
        out = out.replace(/!\[:[^\]]+\]\([^)]+\)/g, '');
        // 将复杂图片链接格式转换为纯图片格式
        out = out.replace(/\[!\[([^\]]*)\]\(([^)]+)\)[^\]]*\]\([^)]+\)/g, '![$1]($2)');
        // 删除引用块中的空行（> 后面只有空格或空行的）
        out = out.replace(/^>\s*$/gm, '');
        // 删除代码块结束标记前的空行（只处理 \n``` 这种出现在代码块结束前的情况）
        out = out.replace(/\n{2,}```/g, '\n```');
        // 多个空行合并为两个
        out = out.replace(/\n{3,}/g, '\n\n');
        // 去除首尾空白
        return out.replace(/^\s+|\s+$/g, '');
    }

    // HTML 转义（同时适用于文本节点与属性值）
    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // 轻量 Markdown 转 HTML（基础语法）
    function markdownToHtml(md) {
        if (!md) return '';

        // 代码块 / 行内代码先抽出来，避免后续语法误伤
        const placeholders = [];
        const stash = (html) => {
            placeholders.push(html);
            return `\u0000BLOCK${placeholders.length - 1}\u0000`;
        };

        let text = String(md);
        text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) =>
            stash(`<pre><code class="language-${escapeHtml(lang || '')}">${escapeHtml(code)}</code></pre>`));
        text = text.replace(/`([^`\n]+)`/g, (_, code) =>
            stash(`<code>${escapeHtml(code)}</code>`));

        // 先整体转义，避免正文中的 HTML 被渲染
        text = escapeHtml(text);

        // 图片与链接
        text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) =>
            `<img alt="${alt}" src="${src}">`);
        text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
            `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);

        // 粗体 / 斜体
        text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // 标题
        text = text.replace(/^(#{6})\s+(.+)$/gm, '<h6>$2</h6>')
            .replace(/^(#{5})\s+(.+)$/gm, '<h5>$2</h5>')
            .replace(/^(#{4})\s+(.+)$/gm, '<h4>$2</h4>')
            .replace(/^(#{3})\s+(.+)$/gm, '<h3>$2</h3>')
            .replace(/^(#{2})\s+(.+)$/gm, '<h2>$2</h2>')
            .replace(/^(#{1})\s+(.+)$/gm, '<h1>$2</h1>');

        // 水平线
        text = text.replace(/^\s*[-*_]{3,}\s*$/gm, '<hr>');

        // 引用
        text = text.replace(/^(?:>\s?(.*))$/gm, '<blockquote><p>$1</p></blockquote>');

        // 无序列表（连续项聚合）
        text = text.replace(/(?:^(?:\s*-\s+.+)\n?)+/gm, (block) => {
            const items = block.trim().split(/\n/).map(line => line.replace(/^\s*-\s+/, '').trim());
            return '<ul>' + items.map(item => `<li>${item}</li>`).join('') + '</ul>';
        });

        // 有序列表（连续项聚合）
        text = text.replace(/(?:^(?:\s*\d+\.\s+.+)\n?)+/gm, (block) => {
            const items = block.trim().split(/\n/).map(line => line.replace(/^\s*\d+\.\s+/, '').trim());
            return '<ol>' + items.map(item => `<li>${item}</li>`).join('') + '</ol>';
        });

        // 段落：已是块级元素或占位符的片段不再包裹
        const html = text.split('\n')
            .filter(seg => seg.trim().length > 0)
            .map(seg => {
                if (/^\s*<(h\d|ul|ol|li|pre|blockquote|hr)/i.test(seg)) return seg;
                if (/^\s*\u0000BLOCK\d+\u0000\s*$/.test(seg)) return seg;
                return `<p>${seg}</p>`;
            })
            .join('');

        // 还原代码块
        return html.replace(/\u0000BLOCK(\d+)\u0000/g, (_, i) => placeholders[Number(i)] || '');
    }

    // 设置弹窗结构
    function buildSettingsDialogHtml() {
        const currentRepo = CONFIG.repoPath || '';
        const currentToken = CONFIG.accessToken || '';
        const currentHotkey = START_HOTKEY || '';
        const currentHotkeyEnabled = !!HOTKEY_ENABLED;
        const currentClipIssue = String(readSetting(currentRegion().clipKey, '') || '');
        const currentFavIssue = String(readSetting(currentRegion().favKey, '') || '');

        return `
            <button class="cnb-dialog-close" title="关闭" style="position:absolute; right:10px; top:10px; border:none; background:transparent; color:#000; font-size:20px; line-height:1; cursor:pointer; font-weight:700;">×</button>
            <div class="cnb-settings-header">
                <h3>CNB 设置</h3>
                <button type="button" id="cnb-btn-region" class="cnb-region-toggle" title="切换 CNB 服务器（国内 / 国外）">${regionLabel()}</button>
                <div class="cnb-settings-links-row">
                    <a class="cnb-link-btn" href="https://github.com/IIIStudio/CNBIssue" target="_blank" rel="noopener noreferrer">GitHub</a>
                    <a class="cnb-link-btn" href="https://cnb.cool/IIIStudio/Code/Greasemonkey/CNBIssue" target="_blank" rel="noopener noreferrer">CNB</a>
                    <a class="cnb-link-btn" href="https://scriptcat.org/zh-CN/script-show-page/4421" target="_blank" rel="noopener noreferrer">ScriptCat</a>
                </div>
            </div>
            <div>
                <label>仓库路径 (owner/repo):</label>
                <input class="cnb-control" type="text" id="cnb-setting-repo" placeholder="例如: IIIStudio/Demo" value="${escapeHtml(currentRepo)}">
            </div>
            <div>
                <label>访问令牌 (accessToken):</label>
                <input class="cnb-control" type="password" id="cnb-setting-token" placeholder="输入访问令牌" value="${escapeHtml(currentToken)}">
                <div class="cnb-hint">注意：上传图片需要访问令牌具有 <strong>repo-code:rw</strong> 权限</div>
            </div>
            <div>
                <label>剪贴板位置（Issue编号）:</label>
                <input class="cnb-control" type="text" id="cnb-setting-clip-issue" placeholder="例如: 25（留空则隐藏剪贴板按钮）" value="${escapeHtml(currentClipIssue)}">
            </div>
            <div>
                <label>评论收藏（Issue编号）:</label>
                <input class="cnb-control" type="text" id="cnb-setting-fav-issue" placeholder="例如: 1|收藏，5|阅读" value="${escapeHtml(currentFavIssue)}">
                <div class="cnb-hint">格式: Issue号|名称，多个用逗号分隔（如: 1|收藏,5|阅读）</div>
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
    }

    // 拉取仓库全部标签名（分页）
    async function fetchRepoTagNames(repo, token) {
        const pageSize = 50;
        const names = [];

        for (let page = 1; page <= 50; page++) {
            const data = await new Promise((resolve, reject) => {
                apiRequest({
                    method: 'GET',
                    repo,
                    token,
                    path: `/-/labels?page=${page}&page_size=${pageSize}`
                }, (err, res) => (err ? reject(err) : resolve(res)));
            });

            const labels = Array.isArray(data) ? data : (Array.isArray(data && data.data) ? data.data : []);
            labels.forEach(label => names.push(label.name || label.title || label));

            const total = (data && (data.total_count ?? data.total ?? data.totalCount)) || 0;
            if (labels.length < pageSize || names.length >= total) break;
        }

        return names.filter(Boolean);
    }

    // 设置弹窗
    function openSettingsDialog() {
        const modal = openModal('settings', {
            html: buildSettingsDialogHtml(),
            escClose: true
        });
        const { dialog, close } = modal;
        const pick = (sel) => dialog.querySelector(sel);

        const repoInput = pick('#cnb-setting-repo');
        const tokenInput = pick('#cnb-setting-token');
        const tagsList = pick('#cnb-setting-tags-list');
        const newTagInput = pick('#cnb-setting-newtag');
        const addTagBtn = pick('#cnb-setting-addtag');
        const clipIssueInput = pick('#cnb-setting-clip-issue');
        const favIssueInput = pick('#cnb-setting-fav-issue');
        const hotkeyInput = pick('#cnb-setting-hotkey');
        const hotkeyEnabledInput = pick('#cnb-setting-hotkey-enabled');

        const currentRepo = () => (repoInput ? repoInput.value.trim() : '');
        const currentToken = () => (tokenInput ? tokenInput.value.trim() : '');

        const persistTags = () => saveSetting('cnbTags', SAVED_TAGS);

        const renderTagsList = () => {
            if (!tagsList) return;
            tagsList.innerHTML = '';

            const tags = Array.isArray(SAVED_TAGS) ? SAVED_TAGS : [];
            if (tags.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'cnb-hint';
                empty.textContent = '暂无标签';
                tagsList.appendChild(empty);
                return;
            }

            tags.forEach((tag, index) => {
                const item = document.createElement('span');
                item.className = 'cnb-tag-pill';
                item.textContent = tag;

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.textContent = '×';
                removeBtn.title = '删除';
                removeBtn.className = 'cnb-tag-delbtn';
                removeBtn.addEventListener('click', async () => {
                    const repo = currentRepo();
                    const token = currentToken();

                    // 配置完整时同步删除仓库中的标签，失败也不影响本地删除
                    if (repo && token) {
                        try {
                            await new Promise((resolve, reject) => {
                                apiRequest({
                                    method: 'DELETE',
                                    repo,
                                    token,
                                    path: `/-/labels/${encodeURIComponent(tag)}`
                                }, (err) => (err ? reject(err) : resolve()));
                            });
                        } catch (error) {
                            console.warn('[CNB Issue] 从仓库删除标签失败:', error);
                        }
                    }

                    SAVED_TAGS.splice(index, 1);
                    persistTags();
                    renderTagsList();
                });

                item.appendChild(removeBtn);
                tagsList.appendChild(item);
            });
        };

        const refreshTags = async () => {
            const repo = currentRepo();
            const token = currentToken();
            if (!repo || !token) {
                SAVED_TAGS = [];
                renderTagsList();
                return;
            }
            try {
                const names = await fetchRepoTagNames(repo, token);
                SAVED_TAGS = names;
                persistTags();
                renderTagsList();
                notifyUser(names.length > 0 ? `已获取 ${names.length} 个标签` : '仓库暂无标签', 2000);
            } catch (error) {
                // 静默失败，不影响对话框打开
                console.warn('[CNB Issue] 获取标签失败:', error);
            }
        };

        const addTag = async () => {
            const tag = (newTagInput && newTagInput.value || '').trim();
            if (!tag) return;

            const repo = currentRepo();
            const token = currentToken();
            if (!repo || !token) {
                notifyUser('请先配置仓库路径和访问令牌');
                return;
            }

            try {
                await new Promise((resolve, reject) => {
                    apiRequest({
                        method: 'POST',
                        repo,
                        token,
                        path: '/-/labels',
                        data: { name: tag }
                    }, (err) => (err ? reject(err) : resolve()));
                });

                if (!Array.isArray(SAVED_TAGS)) SAVED_TAGS = [];
                if (!SAVED_TAGS.includes(tag)) {
                    SAVED_TAGS.push(tag);
                    persistTags();
                    renderTagsList();
                    newTagInput.value = '';
                    notifyUser('标签已添加', 1500);
                }
            } catch (error) {
                notifyUser(`添加标签失败: ${error.message}`);
            }
        };

        /* ---- 事件绑定 ---- */

        const regionToggle = pick('#cnb-btn-region');
        if (regionToggle) {
            regionToggle.addEventListener('click', (e) => {
                e.preventDefault();
                switchRegion();
            });
        }

        // 评论收藏即时保存
        if (favIssueInput) {
            favIssueInput.addEventListener('input', () => saveSetting(currentRegion().favKey, favIssueInput.value.trim()));
        }

        // 仓库路径即时保存
        if (repoInput) {
            repoInput.addEventListener('input', () => {
                const repo = repoInput.value.trim();
                if (!repo) return;
                CONFIG.repoPath = repo;
                saveSetting(currentRegion().repoKey, repo);
            });
        }

        // 访问令牌即时保存
        if (tokenInput) {
            tokenInput.addEventListener('input', () => {
                const token = tokenInput.value.trim();
                if (!token) return;
                CONFIG.accessToken = token;
                saveSetting(currentRegion().tokenKey, token);
            });
        }

        // 剪贴板位置即时保存并生效
        if (clipIssueInput) {
            clipIssueInput.addEventListener('input', () => {
                saveSetting(currentRegion().clipKey, clipIssueInput.value.trim());
                syncDockClipboardButton();
            });
        }

        if (hotkeyEnabledInput) {
            hotkeyEnabledInput.addEventListener('change', () => {
                HOTKEY_ENABLED = !!hotkeyEnabledInput.checked;
                saveSetting('cnbHotkeyEnabled', HOTKEY_ENABLED);
            });
        }

        // 录制快捷键：在输入框中按组合键即生成规范字符串
        if (hotkeyInput) {
            hotkeyInput.addEventListener('keydown', (e) => {
                e.preventDefault();
                START_HOTKEY = normalizeHotkeyString(eventToHotkeyString(e));
                hotkeyInput.value = toDisplayHotkeyString(START_HOTKEY);
                saveSetting('cnbHotkey', START_HOTKEY);
            });
        }

        // 回车键添加标签
        if (newTagInput && addTagBtn) {
            newTagInput.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                addTagBtn.click();
            });
            addTagBtn.addEventListener('click', addTag);
        }

        // 关闭按钮
        const closeBtn = pick('.cnb-dialog-close');
        if (closeBtn) closeBtn.addEventListener('click', close);

        // 供区域切换调用：同步新区域的仓库/令牌/剪贴板/收藏，并重新拉取标签
        modal.refresh = () => {
            if (repoInput) repoInput.value = CONFIG.repoPath || '';
            if (tokenInput) tokenInput.value = CONFIG.accessToken || '';
            if (clipIssueInput) clipIssueInput.value = String(readSetting(currentRegion().clipKey, '') || '');
            if (favIssueInput) favIssueInput.value = String(readSetting(currentRegion().favKey, '') || '');
            refreshTags();
        };

        renderTagsList();
        refreshTags();
    }

    // Issue 列表：单行渲染
    function buildIssueRow(issue) {
        const number = issue.number ?? issue.id ?? issue.iid ?? '';
        const title = String(issue.title ?? '');
        const createdAt = issue.created_at ?? '';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 8px;border-bottom:2px solid #000;';

        const left = document.createElement('div');
        left.style.cssText = 'min-width:0;flex:1;font-size:13px;color:#000;display:flex;gap:6px !important;align-items:center;';

        const prefix = document.createElement('span');
        prefix.textContent = `#${number}`;
        prefix.style.fontWeight = '700';

        const link = document.createElement('a');
        link.href = `${CONFIG.webBase}/${CONFIG.repoPath}/-/issues/${number}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = title.length > 30 ? title.slice(0, 30) + '…' : title;
        link.title = title;
        link.style.cssText = 'color:#000;text-decoration:none;word-break:break-all;font-weight:500;';
        link.addEventListener('mouseover', () => { link.style.textDecoration = 'underline'; });
        link.addEventListener('mouseout', () => { link.style.textDecoration = 'none'; });

        // 复制按钮：关闭 Issue 并把标题 + 正文（清理为 Markdown）复制到剪贴板
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.textContent = '复制';
        copyBtn.title = '关闭 Issue 并复制到剪贴板';
        copyBtn.style.cssText = 'margin-left:6px;display:inline-flex;align-items:center;justify-content:center;height:20px;padding:0 8px;border:1px solid #d0d7de;border-radius:4px;background:#f6f8fa;color:#57606a;font-size:11px;font-weight:500;cursor:pointer;line-height:1;transition:all 0.1s ease;';
        copyBtn.addEventListener('mouseover', () => { copyBtn.style.background = '#eaeef2'; copyBtn.style.color = '#24292f'; copyBtn.style.borderColor = '#afb8c1'; });
        copyBtn.addEventListener('mouseout', () => { copyBtn.style.background = '#f6f8fa'; copyBtn.style.color = '#57606a'; copyBtn.style.borderColor = '#d0d7de'; });
        copyBtn.addEventListener('click', () => {
            if (copyBtn.disabled) return;
            copyBtn.disabled = true;
            const oldText = copyBtn.textContent;
            copyBtn.textContent = '…';

            apiRequest({
                method: 'PATCH',
                path: `${CONFIG.issueEndpoint}/${number}`,
                accept: 'application/json',
                data: { state: 'closed', state_reason: 'completed' }
            }, function(err, obj) {
                try {
                    if (err) {
                        notifyUser(`操作失败: ${err.message}`, 5000);
                        return;
                    }
                    const finalTitle = (obj && obj.title) ? obj.title : title;
                    const body = (obj && typeof obj.body === 'string') ? obj.body : '';
                    const markdown = cleanMarkdownContent(body);
                    if (typeof GM_setClipboard === 'function') {
                        GM_setClipboard(`${finalTitle}\n\n${markdown}`, 'text');
                    }
                    notifyUser('已关闭并复制到剪贴板');
                } finally {
                    copyBtn.disabled = false;
                    copyBtn.textContent = oldText;
                }
            });
        });

        left.appendChild(prefix);
        left.appendChild(link);
        left.appendChild(copyBtn);

        // 右侧：标签胶囊 + 创建时间
        const right = document.createElement('div');
        right.style.cssText = 'flex:0 0 auto;color:#57606a;font-size:11px;text-align:right;display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;';

        const labelsWrap = document.createElement('div');
        labelsWrap.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;';

        (Array.isArray(issue.labels) ? issue.labels : []).forEach(label => {
            const chip = document.createElement('span');
            chip.className = 'cnb-issue-chip';
            chip.textContent = (label && label.name) ?? '';
            applyLabelChipColor(chip, label && label.color);
            labelsWrap.appendChild(chip);
        });

        const dateSpan = document.createElement('span');
        dateSpan.textContent = createdAt;
        dateSpan.style.cssText = 'color:#57606a;';

        right.appendChild(labelsWrap);
        right.appendChild(dateSpan);

        row.appendChild(left);
        row.appendChild(right);
        return row;
    }

    // 根据标签颜色设置胶囊的底色与前景色
    function applyLabelChipColor(chip, color) {
        if (!color || typeof color !== 'string') return;
        chip.style.background = color;
        try {
            const hex = color.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            chip.style.color = luminance < 140 ? '#fff' : '#24292f';
            chip.style.borderColor = luminance < 140 ? 'rgba(255,255,255,0.35)' : '#d0d7de';
        } catch (_) {}
    }

    // Issue 列表：筛选按钮栏
    function buildIssueFilterBar(container, tags, onSelect) {
        if (!container) return;
        container.innerHTML = '';

        const addPressEffect = (btn) => {
            btn.addEventListener('mousedown', () => btn.classList.add('pressed'));
            btn.addEventListener('mouseup', () => btn.classList.remove('pressed'));
            btn.addEventListener('mouseleave', () => btn.classList.remove('pressed'));
            btn.addEventListener('touchstart', () => btn.classList.add('pressed'), { passive: true });
            btn.addEventListener('touchend', () => btn.classList.remove('pressed'));
            btn.addEventListener('touchcancel', () => btn.classList.remove('pressed'));
            btn.addEventListener('blur', () => btn.classList.remove('pressed'));
        };

        const setActive = (btn) => {
            container.querySelectorAll('button').forEach(x => x.classList.remove('active'));
            btn.classList.add('active');
        };

        const createBtn = (text, label, active) => {
            const btn = document.createElement('button');
            btn.className = 'cnb-issue-filter-btn' + (active ? ' active' : '');
            btn.textContent = text;
            addPressEffect(btn);
            btn.addEventListener('click', () => {
                setActive(btn);
                onSelect(label);
            });
            return btn;
        };

        container.appendChild(createBtn('全部', null, true));
        (Array.isArray(tags) ? tags : []).forEach(tag => {
            container.appendChild(createBtn(tag, tag, false));
        });
    }

    // Issue 列表弹窗
    function openIssueList() {
        if (!CONFIG.repoPath || !CONFIG.accessToken) {
            notifyUser('请先在设置中配置仓库路径与访问令牌');
            openSettingsDialog();
            return;
        }

        // 列表与剪贴板窗口互斥，避免标签栏叠加
        closeModal('clipboard');

        const modal = openModal('issueList', {
            html: `
                <button class="cnb-dialog-close" title="关闭" style="position:absolute; right:10px; top:10px; border:none; background:transparent; color:#000; font-size:20px; line-height:1; cursor:pointer; font-weight:700;">×</button>
                <h3>Issue 列表</h3>
                <div id="cnb-issue-filter" class="cnb-issue-filter" style="margin:4px 0;"></div>
                <div id="cnb-issue-list" style="height:55vh; overflow:auto; border:2px solid #000; border-radius:0;"></div>
            `,
            // 固定对话框尺寸，防止点击筛选按钮时窗口抖动
            cssText: 'width:840px;max-width:840px;',
            escClose: true
        });
        const { dialog, close } = modal;

        const listEl = dialog.querySelector('#cnb-issue-list');
        const closeBtn = dialog.querySelector('.cnb-dialog-close');
        if (closeBtn) closeBtn.addEventListener('click', close);

        // 无限滚动状态
        const pageSize = 50;
        let nextPage = 1;
        let hasMore = true;
        let loading = false;
        let allItems = [];
        let currentFilterLabel = null;

        const showMessage = (text) => {
            listEl.innerHTML = `<div style="padding:12px;color:#000;font-weight:600;">${text}</div>`;
        };

        const renderList = (filterLabel, keepScroll) => {
            const prevScrollTop = listEl.scrollTop;
            const filtered = !filterLabel
                ? allItems
                : allItems.filter(issue => {
                    const names = Array.isArray(issue.labels) ? issue.labels.map(l => l.name) : [];
                    return names.includes(filterLabel);
                });

            const frag = document.createDocumentFragment();
            filtered.forEach(issue => frag.appendChild(buildIssueRow(issue)));

            listEl.innerHTML = '';
            listEl.appendChild(frag);
            listEl.scrollTop = keepScroll ? prevScrollTop : 0;
        };

        // 内容不足一屏且还有更多时自动继续加载
        const maybeAutoLoad = () => {
            if (hasMore && !loading && listEl.scrollHeight <= listEl.clientHeight + 4) {
                loadPage(nextPage);
            }
        };

        const loadPage = (page) => {
            if (loading || !hasMore) return;
            loading = true;

            const isFirst = page === 1;
            if (isFirst) showMessage('加载中...');

            apiRequest({
                method: 'GET',
                path: `${CONFIG.issueEndpoint}?page=${page}&page_size=${pageSize}&state=closed`,
                accept: 'application/json'
            }, function(err, data) {
                loading = false;
                if (err) {
                    if (isFirst) showMessage('加载失败');
                    else notifyUser('加载下一页失败：' + err.message, 4000);
                    return;
                }

                const items = Array.isArray(data) ? data : (Array.isArray(data && data.items) ? data.items : []);
                allItems = isFirst ? items : allItems.concat(items);
                hasMore = items.length === pageSize; // 满一页说明可能还有下一页
                nextPage = page + 1;

                if (allItems.length === 0) {
                    showMessage('暂无数据');
                    return;
                }

                renderList(currentFilterLabel, true);
                maybeAutoLoad();
            });
        };

        // 滚动到底部附近时加载下一页
        listEl.addEventListener('scroll', () => {
            if (!hasMore || loading) return;
            if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 40) {
                loadPage(nextPage);
            }
        });

        buildIssueFilterBar(dialog.querySelector('#cnb-issue-filter'), SAVED_TAGS, (label) => {
            currentFilterLabel = label;
            renderList(label, false);
            maybeAutoLoad();
        });

        loadPage(1);
    }

    // 剪贴板窗口样式
    function injectClipboardStyles() {
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
                z-index: 2147483644;
                overflow: hidden;
                font: 13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Helvetica,Arial,"PingFang SC","Microsoft Yahei",sans-serif;
                color: #000;
                opacity: 1;
                pointer-events: auto;
                transition: opacity 0.3s ease;
            }
            .cnb-clipwin-header {
                position: relative;
                height: 28px;
                border-bottom: 2px solid #000;
                background: #000;
                cursor: move;
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
            .cnb-clipwin-title {
                position: absolute;
                left: 6px; top: 6px;
                border: none; background: transparent;
                color: #fff; line-height: 1; font-size: 11px; font-weight: 600;
                text-transform: uppercase;
                pointer-events: auto;
            }
            .cnb-clipwin-title a { color: #fff; text-decoration: none; }
            .cnb-clipwin-title a:hover { text-decoration: underline; }
            .cnb-clipwin-close:hover, .cnb-clipwin-pin:hover { color: #ccc; }
            .cnb-clipwin-pin svg { fill: rgba(255, 255, 255, 0.5); transition: fill 0.15s ease; }
            .cnb-clipwin-pin:hover svg { fill: rgba(255, 255, 255, 0.8); }
            .menuBar-Btn_Icon-pin.isActive { fill: #2ea043 !important; }
            .cnb-clipwin-content { padding: 5px; overflow: auto; }
            .cnb-clipwin-tabs {
                position: fixed;
                display: flex;
                flex-direction: column;
                z-index: 2147483645;
                opacity: 1;
                pointer-events: auto;
                transition: opacity 0.3s ease;
            }
            .cnb-clipwin-tab {
                margin: 1px 0;
                padding: 3px 10px;
                background: #f5f5f5;
                border: 2px solid #000;
                border-right: none;
                cursor: pointer;
                font-size: 12px;
                font-weight: 500;
                color: #000;
                text-align: right;
                width: auto;
                flex-shrink: 0;
                align-self: flex-end;
            }
            .cnb-clipwin-tab:hover { background: #e0e0e0; }
            .cnb-clipwin-tab.active { background: #fff; color: #000; font-weight: 600; }
            .cnb-clipwin-tab.active::after {
                content: '';
                display: block;
                margin-right: -1px;
                height: 100%;
                width: 1px;
                background: #fff;
            }
        `);

        addStyleOnce('clipwin-body', `
            .cnb-clipwin-body {
                margin: 0;
                padding: 5px;
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
            .cnb-clipwin-body * { margin-top: 0 !important; margin-bottom: 0 !important; }
            .cnb-clipwin-body h1 { font-size: 1.5em; margin: .3em 0 .2em 0 !important; font-weight: 700; color: #000; }
            .cnb-clipwin-body h2 { font-size: 1.3em; margin: .3em 0 .2em 0 !important; font-weight: 700; color: #000; }
            .cnb-clipwin-body h3 { font-size: 1.15em; margin: .3em 0 .2em 0 !important; font-weight: 700; color: #000; }
            .cnb-clipwin-body p { margin: .2em 0 !important; color: #000; }
            .cnb-clipwin-body ul, .cnb-clipwin-body ol { padding-left: 1.3em; margin: .2em 0 !important; color: #000; }
            .cnb-clipwin-body blockquote {
                margin: .2em 0 !important; padding: .3em .6em; color: #000; background: #f5f5f5; border-left: 3px solid #000; border-radius: 0;
            }
            .cnb-clipwin-body hr { border: none; border-top: 2px solid #000; margin: .3em 0 !important; }
            .cnb-clipwin-body code {
                background: #000; border: none; border-radius: 0; padding: .08em .3em;
                font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
                font-size: .88em; color: #fff;
            }
            .cnb-clipwin-body pre {
                background: #000; color: #fff; border-radius: 0; padding: 8px; margin: .2em 0 .3em 0 !important;
                overflow-x: hidden; overflow-y: auto;
            }
            .cnb-clipwin-body pre code {
                background: transparent; border: none; padding: 0; color: inherit; font-size: .92em;
                white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;
            }
            .cnb-clipwin-body a { color: #000; text-decoration: underline; font-weight: 500; }
            .cnb-clipwin-body a:hover { text-decoration: underline; color: #666; }
        `);

        addStyleOnce('clipwin-scrollbar', `
            .cnb-clipwin, .cnb-clipwin-content, .cnb-clipwin-body, .cnb-clipwin-body pre {
                scrollbar-width: thin;
                scrollbar-color: #000 #f5f5f5;
            }
            .cnb-clipwin::-webkit-scrollbar,
            .cnb-clipwin-content::-webkit-scrollbar,
            .cnb-clipwin-body::-webkit-scrollbar,
            .cnb-clipwin-body pre::-webkit-scrollbar { width: 8px; height: 8px; }
            .cnb-clipwin::-webkit-scrollbar-track,
            .cnb-clipwin-content::-webkit-scrollbar-track,
            .cnb-clipwin-body::-webkit-scrollbar-track,
            .cnb-clipwin-body pre::-webkit-scrollbar-track { background: #f5f5f5; }
            .cnb-clipwin::-webkit-scrollbar-thumb,
            .cnb-clipwin-content::-webkit-scrollbar-thumb,
            .cnb-clipwin-body::-webkit-scrollbar-thumb,
            .cnb-clipwin-body pre::-webkit-scrollbar-thumb { background: #000; border-radius: 0; }
            .cnb-clipwin::-webkit-scrollbar-thumb:hover,
            .cnb-clipwin-content::-webkit-scrollbar-thumb:hover,
            .cnb-clipwin-body::-webkit-scrollbar-thumb:hover,
            .cnb-clipwin-body pre::-webkit-scrollbar-thumb:hover { background: #333; }
        `);

        addStyleOnce('clipwin-pre-controls', `
            .cnb-clipwin-body pre,
            .cnb-clipwin-body pre.cnb-pre-collapsed { position: relative; }
            .cnb-pre-collapsed { max-height: 3.2em; overflow: hidden; }
            .cnb-pre-collapsed::after {
                content: '';
                position: absolute;
                left: 0; right: 0; bottom: 0;
                height: 28px;
                background: linear-gradient(to bottom, rgba(11,16,33,0), rgba(11,16,33,0.85));
                pointer-events: none;
            }
            .cnb-code-controls {
                position: absolute;
                top: 4px;
                right: 6px;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                z-index: 2;
            }
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
            .cnb-code-controls .cnb-code-toggle:hover { background: #fff; color: #000; }
        `);

        addStyleOnce('clipwin-inline-tabs', `
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
                padding: 2px 8px;
                background: #fff;
                color: #000;
                cursor: pointer;
                font-size: 11px;
                font-weight: 500;
                line-height: 1.1;
                transition: all 0.1s ease;
            }
            .cnb-tab-inline:hover { background: #000; color: #fff; }
            .cnb-tab-inline.active { background: #000; color: #fff; }
            .cnb-tab-inline:focus { outline: none; }
        `);
    }

    function buildClipboardHtml() {
        return `
            <div class="cnb-clipwin-header">
                <div class="cnb-clipwin-title">剪贴板</div>
                <button class="cnb-clipwin-pin" title="固定/取消固定">
                    <svg class="menuBar-Btn_Icon" width="15" height="15" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 53.011 53.011">
                        <path class="menuBar-Btn_Icon-pin" d="M52.963 21.297c-.068-.33-.297-.603-.61-.727-8.573-3.416-16.172-.665-18.36.288L19.113 8.2C19.634 3.632 17.17.508 17.06.372c-.18-.22-.442-.356-.725-.372-.282-.006-.56.09-.76.292L.32 15.546c-.202.2-.308.48-.29.765.015.285.152.55.375.727 2.775 2.202 6.35 2.167 7.726 2.055l12.722 14.953c-.868 2.23-3.52 10.27-.307 18.337.124.313.397.54.727.61.067.013.135.02.202.02.263 0 .518-.104.707-.293l14.57-14.57 13.57 13.57c.196.194.452.292.708.292s.512-.098.707-.293c.39-.392.39-1.024 0-1.415l-13.57-13.57 14.527-14.528c.237-.238.34-.58.27-.91zm-17.65 15.458L21.89 50.18c-2.437-8.005.993-15.827 1.03-15.91.158-.352.1-.764-.15-1.058L9.31 17.39c-.19-.225-.473-.352-.764-.352-.05 0-.103.004-.154.013-.036.007-3.173.473-5.794-.954l13.5-13.5c.604 1.156 1.39 3.26.964 5.848-.058.346.07.697.338.924l15.785 13.43c.31.262.748.31 1.105.128.077-.04 7.378-3.695 15.87-1.017L35.313 36.754z"></path>
                    </svg>
                </button>
                <button class="cnb-clipwin-close" title="关闭">×</button>
            </div>
            <div class="cnb-clipwin-content">
                <pre id="cnb-clipwin-body" class="cnb-clipwin-body">加载中…</pre>
            </div>
        `;
    }

    // 把窗口从 transform 居中改成 left/top 定位，方便拖动与切换标签
    function fixDialogPosition(dialog) {
        if (!dialog.style.transform || dialog.style.transform === 'none') return;
        const rect = dialog.getBoundingClientRect();
        dialog.style.left = rect.left + 'px';
        dialog.style.top = rect.top + 'px';
        dialog.style.transform = 'none';
    }

    function copyText(text) {
        const value = String(text || '');
        try {
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(value, 'text');
                return true;
            }
        } catch (_) {}
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(value);
                return true;
            }
        } catch (_) {}
        return false;
    }

    // 代码块：点击复制 + 折叠/展开
    function decorateCodeBlocks(bodyEl) {
        if (!bodyEl) return;

        bodyEl.querySelectorAll('pre').forEach(pre => {
            pre.style.marginTop = '5px';
            pre.style.marginBottom = '5px';
            pre.style.cursor = 'pointer';
            pre.style.transition = 'background-color 0.15s ease';

            pre.addEventListener('click', () => {
                const codeEl = pre.querySelector('code');
                const text = String((codeEl ? codeEl.textContent : pre.textContent) || '').trim();
                if (!copyText(text)) return;

                const prevBg = pre.style.backgroundColor;
                pre.style.backgroundColor = 'rgba(46, 160, 67, 0.3)';
                setTimeout(() => { pre.style.backgroundColor = prevBg; }, 200);
                notifyUser('代码已复制', 1500);
            });

            // 超过两行的代码块默认折叠
            const codeEl = pre.querySelector('code') || pre;
            const lines = String(codeEl.textContent || '').split('\n');
            if (lines.length <= 2) return;

            pre.classList.add('cnb-pre-collapsed');

            const controls = document.createElement('div');
            controls.className = 'cnb-code-controls';
            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'cnb-code-toggle';
            toggleBtn.textContent = '展开';
            toggleBtn.title = '展开/收起';
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const collapsed = pre.classList.toggle('cnb-pre-collapsed');
                toggleBtn.textContent = collapsed ? '展开' : '收起';
            });
            controls.appendChild(toggleBtn);
            pre.appendChild(controls);
        });
    }

    // 清理多余空节点并隐藏章节标题（章节改用按钮切换）
    function tidyClipboardBody(bodyEl) {
        if (!bodyEl) return;

        bodyEl.querySelectorAll('br').forEach(br => br.remove());

        bodyEl.querySelectorAll('p').forEach(p => {
            const text = (p.textContent || '').trim();
            const onlyBr = p.children.length === 1 && p.firstElementChild && p.firstElementChild.tagName.toLowerCase() === 'br';
            if (!text || onlyBr) {
                p.remove();
                return;
            }
            p.style.marginTop = '0';
            p.style.marginBottom = '0';
        });

        bodyEl.querySelectorAll('pre').forEach(pre => {
            pre.style.marginTop = '0';
            pre.style.marginBottom = '0';
        });

        bodyEl.querySelectorAll('h2').forEach(h => {
            h.style.display = 'none';
            h.style.margin = '0';
            h.style.padding = '0';
        });
    }

    // 以 h2 为界把正文拆成多个 section，并在顶部生成切换按钮
    function buildSectionTabs(contentDiv, bodyEl, dialog) {
        if (!contentDiv || !bodyEl) return;

        const headings = Array.from(bodyEl.querySelectorAll('h2'));
        if (headings.length <= 1) return;

        const sections = headings.map(h => {
            const section = document.createElement('div');
            section.className = 'cnb-sec';
            h.parentNode.insertBefore(section, h);
            section.appendChild(h);

            let next = section.nextSibling;
            while (next && !(next.nodeType === 1 && next.tagName && next.tagName.toLowerCase() === 'h2')) {
                const move = next;
                next = next.nextSibling;
                section.appendChild(move);
            }
            section.style.margin = '0';
            section.style.padding = '0';
            return section;
        });

        let tabsInline = contentDiv.querySelector('.cnb-clipwin-tabs-inline');
        if (!tabsInline) {
            tabsInline = document.createElement('div');
            tabsInline.className = 'cnb-clipwin-tabs-inline';
            contentDiv.insertBefore(tabsInline, bodyEl);
        } else {
            tabsInline.innerHTML = '';
        }

        const activate = (index) => {
            fixDialogPosition(dialog);
            sections.forEach((section, i) => { section.style.display = (i === index) ? '' : 'none'; });
            Array.from(tabsInline.children).forEach((btn, i) => btn.classList.toggle('active', i === index));
        };

        headings.forEach((h, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cnb-tab-inline';
            btn.textContent = (h.textContent || '').trim() || ('Section ' + (index + 1));
            btn.addEventListener('click', () => activate(index));
            tabsInline.appendChild(btn);
        });

        if (tabsInline.firstElementChild) tabsInline.firstElementChild.click();
        fixDialogPosition(dialog);
    }

    // 剪贴板弹窗：展示配置的 Issue 内容
    function openClipboardWindow() {
        if (!CONFIG.repoPath || !CONFIG.accessToken) {
            notifyUser('请先在设置中配置仓库路径与访问令牌');
            openSettingsDialog();
            return;
        }

        closeModal('clipboard');
        injectClipboardStyles();

        // 标签容器（窗口左侧），随窗口一起创建与销毁
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'cnb-clipwin-tabs';
        tabsContainer.style.display = 'none';

        // 关闭时需要解绑的全局事件与定时器
        let cleanupHandlers = () => {};

        const modal = openModal('clipboard', {
            className: 'cnb-clipwin',
            noOverlay: true,
            escClose: true,
            html: buildClipboardHtml(),
            onClose: () => {
                try { cleanupHandlers(); } catch (_) {}
                try { tabsContainer.remove(); } catch (_) {}
            }
        });
        const { dialog, close } = modal;

        const bodyEl = dialog.querySelector('#cnb-clipwin-body');
        const contentDiv = dialog.querySelector('.cnb-clipwin-content');
        const titleEl = dialog.querySelector('.cnb-clipwin-title');

        document.body.appendChild(tabsContainer);

        // 支持逗号分隔的多个 Issue，例如 "2,3,4"
        const issueList = String(readSetting(currentRegion().clipKey, '') || '')
            .split(/[,，]/)
            .map(s => s.trim())
            .filter(Boolean);

        // 固定状态（默认固定）
        let pinned = true;
        try {
            const saved = GM_getValue('cnbClipboardPinned', null);
            if (saved !== null) pinned = Boolean(saved);
        } catch (_) {}

        const pinBtn = dialog.querySelector('.cnb-clipwin-pin');
        const pinPath = pinBtn ? pinBtn.querySelector('.menuBar-Btn_Icon-pin') : null;
        const syncPinState = () => {
            if (pinPath) pinPath.classList.toggle('isActive', pinned);
        };
        syncPinState();
        if (pinBtn) {
            pinBtn.addEventListener('click', () => {
                pinned = !pinned;
                syncPinState();
                saveSetting('cnbClipboardPinned', pinned);
            });
        }

        const closeBtn = dialog.querySelector('.cnb-clipwin-close');
        if (closeBtn) closeBtn.addEventListener('click', close);

        // 未固定时点击窗口外关闭
        const onOutsideClick = (e) => {
            if (pinned) return;
            if (!dialog.contains(e.target) && !tabsContainer.contains(e.target)) close();
        };
        document.addEventListener('click', onOutsideClick, true);

        /* ---- 拖动 ---- */

        const header = dialog.querySelector('.cnb-clipwin-header');
        let dragging = false;
        let startX = 0, startY = 0, boxX = 0, boxY = 0;

        const positionTabs = (left, top) => {
            const tabWidth = tabsContainer.offsetWidth || 80;
            tabsContainer.style.left = (left - tabWidth) + 'px';
            tabsContainer.style.top = (top + 29) + 'px';
            tabsContainer.style.transform = 'none';
        };

        const onDragStart = (e) => {
            if (!header || !header.contains(e.target)) return;
            dragging = true;
            const rect = dialog.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            boxX = rect.left;
            boxY = rect.top;
            dialog.style.left = rect.left + 'px';
            dialog.style.top = rect.top + 'px';
            dialog.style.transform = 'none';
            positionTabs(rect.left, rect.top);
        };

        const onDragEnd = () => {
            if (!dragging) return;
            dragging = false;
            const rect = dialog.getBoundingClientRect();
            saveSetting('cnbClipboardWindowPos', JSON.stringify({ left: rect.left, top: rect.top }));
        };

        const onDragMove = (e) => {
            if (!dragging) return;
            const left = boxX + (e.clientX - startX);
            const top = boxY + (e.clientY - startY);
            dialog.style.left = left + 'px';
            dialog.style.top = top + 'px';
            positionTabs(left, top);
        };

        document.addEventListener('mousedown', onDragStart, true);
        document.addEventListener('mouseup', onDragEnd, true);
        document.addEventListener('mousemove', onDragMove, true);

        /* ---- 自动隐藏 ---- */

        let hideTimer = null;
        let initialized = false;

        cleanupHandlers = () => {
            document.removeEventListener('click', onOutsideClick, true);
            document.removeEventListener('mousedown', onDragStart, true);
            document.removeEventListener('mouseup', onDragEnd, true);
            document.removeEventListener('mousemove', onDragMove, true);
            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }
        };

        const showWindow = () => {
            dialog.style.opacity = '1';
            dialog.style.display = 'flex';
            tabsContainer.style.opacity = '1';
            if (issueList.length > 1) tabsContainer.style.display = 'flex';
        };

        const hideWindow = () => {
            dialog.style.opacity = '0';
            tabsContainer.style.opacity = '0';
        };

        const onEnter = () => {
            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }
            showWindow();
        };

        const onLeave = () => {
            if (!pinned || !initialized) return;
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(hideWindow, 2000);
        };

        dialog.addEventListener('mouseenter', onEnter);
        dialog.addEventListener('mouseleave', onLeave);
        tabsContainer.addEventListener('mouseenter', onEnter);
        tabsContainer.addEventListener('mouseleave', onLeave);

        // 延迟标记初始化，避免创建时立刻触发 mouseleave
        setTimeout(() => { initialized = true; }, 500);

        /* ---- 数据加载 ---- */

        const issueDataCache = {};
        let currentIssueIndex = 0;

        const readTitles = () => {
            const titles = readSetting(currentRegion().clipTitlesKey, {});
            return (titles && typeof titles === 'object') ? titles : {};
        };

        const saveIssueTitle = (issueNum, title) => {
            const titles = readTitles();
            titles[String(issueNum)] = title;
            saveSetting(currentRegion().clipTitlesKey, titles);
        };

        const updateTabTitle = (index, title) => {
            const tab = tabsContainer.children[index];
            if (tab && title) tab.textContent = title;
        };

        const renderIssueContent = (data, issueNum) => {
            const rawBody = (data && typeof data.body === 'string') ? data.body : '';
            const markdown = cleanMarkdownContent(rawBody);

            if (bodyEl) {
                bodyEl.dataset.mdraw = markdown;
                bodyEl.innerHTML = markdownToHtml(markdown);
            }

            const title = (data && typeof data.title === 'string' && data.title) ? data.title : '剪贴板';
            saveIssueTitle(issueNum, title);

            let issueUrl = '';
            if (data && data.web_url) issueUrl = data.web_url;
            else if (data && data.html_url) issueUrl = data.html_url;
            else if (data && data.iid) issueUrl = `${CONFIG.webBase}/${CONFIG.repoPath}/-/issues/${data.iid}`;
            else if (issueNum) issueUrl = `${CONFIG.webBase}/${CONFIG.repoPath}/-/issues/${issueNum}`;

            if (titleEl) {
                if (issueUrl) {
                    const link = document.createElement('a');
                    link.href = issueUrl;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = title;
                    titleEl.innerHTML = '';
                    titleEl.appendChild(link);
                } else {
                    titleEl.textContent = title;
                }
            }

            const tabIndex = issueList.indexOf(String(issueNum));
            if (tabIndex >= 0) updateTabTitle(tabIndex, title);

            decorateCodeBlocks(bodyEl);
            tidyClipboardBody(bodyEl);
            buildSectionTabs(contentDiv, bodyEl, dialog);
        };

        const loadIssue = (issueNum, index) => {
            if (!bodyEl) return;
            bodyEl.textContent = '加载中…';

            if (issueDataCache[index]) {
                renderIssueContent(issueDataCache[index], issueNum);
                return;
            }

            apiRequest({
                method: 'GET',
                path: `${CONFIG.issueEndpoint}/${encodeURIComponent(issueNum)}`,
                accept: 'application/json'
            }, function(err, data) {
                if (err) {
                    bodyEl.textContent = `加载失败 (${err.message})`;
                    return;
                }
                issueDataCache[index] = data;
                renderIssueContent(data, issueNum);
            });
        };

        const renderTabs = () => {
            tabsContainer.innerHTML = '';
            const titles = readTitles();

            issueList.forEach((issueNum, index) => {
                const tab = document.createElement('button');
                tab.type = 'button';
                tab.className = 'cnb-clipwin-tab' + (index === currentIssueIndex ? ' active' : '');
                tab.textContent = titles[String(issueNum)] || issueNum;
                tab.dataset.issueNum = issueNum;
                tab.addEventListener('click', () => {
                    currentIssueIndex = index;
                    Array.from(tabsContainer.children).forEach((btn, i) => btn.classList.toggle('active', i === index));
                    loadIssue(issueNum, index);
                });
                tabsContainer.appendChild(tab);
            });
        };

        renderTabs();

        // 恢复上次的窗口位置
        try {
            const pos = JSON.parse(readSetting('cnbClipboardWindowPos', '') || 'null');
            if (pos && pos.left != null && pos.top != null) {
                dialog.style.left = pos.left + 'px';
                dialog.style.top = pos.top + 'px';
                dialog.style.transform = 'none';
            }
        } catch (_) {}

        if (issueList.length === 0) {
            if (bodyEl) bodyEl.textContent = '未配置剪贴板位置';
            return;
        }

        if (issueList.length > 1) {
            tabsContainer.style.display = 'flex';
            // 等标签渲染完成后再计算位置
            void tabsContainer.offsetHeight;
            const rect = dialog.getBoundingClientRect();
            positionTabs(rect.left, rect.top);
            dialog.style.minHeight = ((tabsContainer.offsetHeight || 0) + 50) + 'px';
        }

        loadIssue(issueList[0], 0);
        showWindow();
    }

    // ===================== 统一 API 请求层 =====================
    // 统一处理：URL 拼接、鉴权头、JSON 解析、错误信息提取、失败通知
    function notifyUser(text, timeout) {
        if (typeof GM_notification === 'function') {
            try {
                GM_notification({ text: text, title: 'CNB Issue工具', timeout: timeout || 3000 });
                return;
            } catch (_) {}
        }
        // 通知器不可用时降级到控制台，避免静默失败
        try { console.log('[CNB Issue]', text); } catch (_) {}
    }

    // 右下角结果提示：显示 10 秒后向右滑出消失
    //   opts = { success, title, url, message }
    //   - success 为 true 时显示「完成！」+ 标题（超链接，最多显示 15 字）
    //   - 否则显示「失败」+ 错误信息
    function showResultToast(opts) {
        const o = opts || {};
        try {
            const old = document.querySelector('.cnb-toast');
            if (old) old.remove();
        } catch (_) {}

        const el = document.createElement('div');
        el.className = 'cnb-toast';

        const prefix = document.createElement('span');
        prefix.className = 'cnb-toast-title';
        prefix.textContent = o.success ? '完成！' : '失败';
        el.appendChild(prefix);

        if (o.success) {
            const t = String(o.title || '').trim();
            if (t) {
                const shown = t.length > 15 ? t.slice(0, 15) + '…' : t;
                if (o.url) {
                    const a = document.createElement('a');
                    a.className = 'cnb-toast-link';
                    a.textContent = ' ' + shown;
                    a.href = o.url;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    el.appendChild(a);
                } else {
                    const span = document.createElement('span');
                    span.textContent = ' ' + shown;
                    el.appendChild(span);
                }
            }
        } else if (o.message) {
            const span = document.createElement('span');
            span.textContent = '：' + String(o.message);
            el.appendChild(span);
        }

        document.body.appendChild(el);
        try { requestAnimationFrame(() => el.classList.add('cnb-toast--show')); }
        catch (_) { el.classList.add('cnb-toast--show'); }

        let removed = false;
        const dismiss = () => {
            if (removed) return;
            removed = true;
            el.classList.remove('cnb-toast--show');
            el.classList.add('cnb-toast--hide');
            setTimeout(() => { try { el.remove(); } catch (_) {} }, 320);
        };

        const timer = setTimeout(dismiss, 10000);
        el.addEventListener('click', (e) => {
            if (e.target && e.target.tagName === 'A') return; // 点击链接正常跳转
            clearTimeout(timer);
            dismiss();
        });
    }

    // 解析响应体（json / blob / text）
    function parseApiResponse(response, responseType) {
        if (responseType === 'blob' || responseType === 'arraybuffer') return response.response;
        if (response.response && typeof response.response === 'object') return response.response;
        try {
            return JSON.parse(response.responseText || '{}');
        } catch (_) {
            return response.response !== undefined ? response.response : (response.responseText || null);
        }
    }

    // 从响应/错误体中提取可读错误信息
    function apiErrorMessage(parsed, response) {
        const msg = `HTTP ${response.status}`;
        let body = (parsed === undefined || parsed === null || parsed === '') ? response.responseText : parsed;
        if (typeof body === 'string') {
            try {
                const j = JSON.parse(body);
                if (j && j.message) return j.message;
            } catch (_) {}
            if (body && body.length < 300 && body[0] !== '{' && body[0] !== '<') return `${msg}: ${body}`;
            return msg;
        }
        if (body && typeof body === 'object' && body.message) return body.message;
        return msg;
    }

    /**
     * 统一请求。
     * @param {Object} options
     *   - method {string}       默认 GET
     *   - path {string}         相对仓库的路径，如 '/-/issues/1'（与 url 二选一）
     *   - url {string}          绝对 URL（与 path 二选一）
     *   - repo {string}         覆盖默认仓库（默认 CONFIG.repoPath）
     *   - token {string}        覆盖默认令牌（默认 CONFIG.accessToken）
     *   - accept {string}       Accept 头，默认 application/vnd.cnb.api+json
     *   - data {any}            请求体，非 rawBody 时自动 JSON.stringify
     *   - rawBody {boolean}     data 是否已序列化
     *   - headers {Object}      额外请求头
     *   - responseType {string} 默认 json
     *   - binary {boolean}      二进制上传
     *   - notifyError {string}  失败时自动通知的前缀
     *   - notifyTimeout {number}
     * @param {(err, data, response) => void} callback
     */
    function apiRequest(options, callback) {
        const opt = options || {};
        const cb = (typeof callback === 'function') ? callback : null;
        const method = (opt.method || 'GET').toUpperCase();
        const accept = opt.accept || 'application/vnd.cnb.api+json';
        const token = opt.token !== undefined ? opt.token : CONFIG.accessToken;
        const repo = opt.repo !== undefined ? opt.repo : CONFIG.repoPath;

        let url = opt.url;
        if (!url) {
            const base = `${CONFIG.apiBase}/${repo}`;
            const p = opt.path || '';
            url = p ? `${base}${p.charAt(0) === '/' ? p : '/' + p}` : base;
        }

        const headers = Object.assign({
            'Accept': accept,
            'Authorization': token
        }, opt.headers || {});

        const responseType = opt.responseType || 'json';
        const hasBody = opt.data !== undefined && opt.data !== null;
        if (hasBody && !opt.rawBody) {
            headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        }

        const request = {
            method,
            url,
            headers,
            responseType,
            onload: function(response) {
                const parsed = parseApiResponse(response, responseType);
                if (response.status >= 200 && response.status < 300) {
                    if (cb) cb(null, parsed, response);
                } else {
                    const msg = apiErrorMessage(parsed, response);
                    if (opt.notifyError) notifyUser(opt.notifyError + msg, opt.notifyTimeout || 5000);
                    if (cb) cb(new Error(msg), parsed, response);
                }
            },
            onerror: function() {
                const msg = '网络请求失败';
                if (opt.notifyError) notifyUser(opt.notifyError + msg, opt.notifyTimeout || 5000);
                if (cb) cb(new Error(msg), null, null);
            }
        };
        if (hasBody) request.data = opt.rawBody ? opt.data : JSON.stringify(opt.data);
        if (opt.binary) request.binary = true;
        if (opt.timeout) request.timeout = opt.timeout;

        GM_xmlhttpRequest(request);
    }

    // 创建Issue
    function createIssue(title, content, labels = [], callback) {
        if (!CONFIG.repoPath || !CONFIG.accessToken) {
            notifyUser('请先在设置中配置仓库路径与访问令牌');
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

        apiRequest({
            method: 'POST',
            path: CONFIG.issueEndpoint,
            accept: 'application/json',
            data: issueData
        }, function(err, respObj) {
            if (err) {
                notifyUser(`创建失败: ${err.message}`, 5000);
                showResultToast({ success: false, message: err.message });
                if (typeof callback === 'function') callback(false);
                return;
            }

            // 解析返回，取 issueId（兼容不同字段）
            const issueId = respObj?.id ?? respObj?.number ?? respObj?.iid ?? respObj?.issue_id;

            // Issue 已创建：立即提示（即使后续设置标签失败也照常提示）
            notifyUser('Issue创建成功！');
            showResultToast({
                success: true,
                title: title,
                url: (issueId != null) ? `${CONFIG.webBase}/${CONFIG.repoPath}/-/issues/${issueId}` : ''
            });

            const notifySuccess = () => {
                if (callback) callback(true, issueId);
            };

            // 若有标签，则单独 PUT 标签
            if (Array.isArray(labels) && labels.length > 0 && issueId != null) {
                apiRequest({
                    method: 'PUT',
                    path: `${CONFIG.issueEndpoint}/${issueId}/labels`,
                    accept: 'application/json',
                    data: { labels }
                }, function(labelErr) {
                    if (labelErr) {
                        notifyUser(`Issue已创建，但设置标签失败：${labelErr.message}`, 5000);
                        if (callback) callback(true, issueId);
                    } else {
                        notifySuccess();
                    }
                });
            } else {
                // 无标签或无法解析 issueId，直接成功
                notifySuccess();
            }
        });
    }

    // 关闭Issue（设置为 closed，state_reason=completed）
    function closeIssue(issueId, stateReason = 'completed', callback) {
        if (issueId == null) {
            if (typeof callback === 'function') callback(false);
            return;
        }
        apiRequest({
            method: 'PATCH',
            path: `${CONFIG.issueEndpoint}/${issueId}`,
            accept: 'application/json',
            notifyError: '标记完成失败：',
            data: { state: 'closed', state_reason: stateReason }
        }, function(err) {
            if (typeof callback === 'function') callback(!err);
        });
    }

    // 更新Issue
    function updateIssue(issueNumber, data, labels = [], callback) {
        if (!CONFIG.repoPath || !CONFIG.accessToken) {
            notifyUser('请先在设置中配置仓库路径与访问令牌');
            if (typeof callback === 'function') callback(false);
            return;
        }

        const labelsPath = `${CONFIG.issueEndpoint}/${issueNumber}/labels`;

        // 比较两个标签数组是否相同
        const labelsEqual = (arr1, arr2) => {
            if (arr1.length !== arr2.length) return false;
            const sorted1 = [...arr1].sort();
            const sorted2 = [...arr2].sort();
            return sorted1.every((val, index) => val === sorted2[index]);
        };

        // 处理标签的函数
        const handleLabels = (afterUpdateCallback) => {
            // 判断是否选择了标签，如果没有选择标签，则跳过标签处理
            if (!Array.isArray(labels) || labels.length === 0) {
                afterUpdateCallback(true);
                return;
            }

            // 先获取当前Issue的标签
            apiRequest({
                method: 'GET',
                path: `${CONFIG.issueEndpoint}/${issueNumber}`
            }, function(err, issueData) {
                const currentLabels = (!err && issueData && issueData.labels) || [];
                const currentNames = currentLabels.map(l => l.name || l);

                // 标签相同则不做任何操作
                if (!err && labelsEqual(currentNames, labels)) {
                    afterUpdateCallback(true);
                    return;
                }

                // 标签有变化（或获取失败）：先删除再添加
                apiRequest({ method: 'DELETE', path: labelsPath }, function() {
                    apiRequest({
                        method: 'PUT',
                        path: labelsPath,
                        data: { labels }
                    }, function(labelErr) {
                        if (labelErr) {
                            notifyUser(`更新标签失败：${labelErr.message}`, 5000);
                        }
                        // 标签更新失败，但Issue已更新，仍然返回成功
                        afterUpdateCallback(true);
                    });
                });
            });
        };

        // 先更新Issue的title和body
        apiRequest({
            method: 'PATCH',
            path: `${CONFIG.issueEndpoint}/${issueNumber}`,
            data: data
        }, function(err) {
            if (err) {
                notifyUser(`更新失败：${err.message}`, 5000);
                showResultToast({ success: false, message: err.message });
                if (typeof callback === 'function') callback(false);
                return;
            }
            // Issue更新成功，处理标签
            handleLabels(() => {
                notifyUser(`Issue #${issueNumber} 更新成功！`);
                showResultToast({
                    success: true,
                    title: (data && data.title) ? data.title : ('#' + issueNumber),
                    url: (issueNumber != null) ? `${CONFIG.webBase}/${CONFIG.repoPath}/-/issues/${issueNumber}` : ''
                });
                if (typeof callback === 'function') callback(true);
            });
        });
    }

    // 获取Issue的标签
    function fetchIssueLabels(issueNumber, callback) {
        if (!CONFIG.repoPath || !CONFIG.accessToken) {
            if (typeof callback === 'function') callback([], '请先配置仓库路径与访问令牌');
            return;
        }

        apiRequest({
            method: 'GET',
            path: `${CONFIG.issueEndpoint}/${issueNumber}/labels`
        }, function(err, data) {
            if (err) {
                if (typeof callback === 'function') callback([], err.message);
                return;
            }
            let labels = [];
            try {
                // CNB API 返回的标签可能是数组
                labels = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
            } catch (e) {
                console.error('解析标签数据失败:', e);
            }
            if (typeof callback === 'function') callback(labels, null);
        });
    }

    // 添加评论到Issue
    function addCommentToIssue(issueNumber, body, callback) {
        if (!CONFIG.repoPath || !CONFIG.accessToken) {
            notifyUser('请先在设置中配置仓库路径与访问令牌');
            if (typeof callback === 'function') callback(false);
            return;
        }

        apiRequest({
            method: 'POST',
            path: `${CONFIG.issueEndpoint}/${issueNumber}/comments`,
            data: { body }
        }, function(err) {
            if (err) {
                notifyUser(`添加评论失败：${err.message}`, 5000);
                showResultToast({ success: false, message: err.message });
                if (typeof callback === 'function') callback(false);
            } else {
                notifyUser('评论添加成功！');
                showResultToast({
                    success: true,
                    title: '#' + issueNumber,
                    url: (issueNumber != null) ? `${CONFIG.webBase}/${CONFIG.repoPath}/-/issues/${issueNumber}` : ''
                });
                if (typeof callback === 'function') callback(true);
            }
        });
    }

    // ===== 上传层（图片 / 附件共用） =====
    // 上传凭证接口与所需权限
    const ASSET_UPLOAD_KINDS = {
        imgs: { path: '/-/upload/imgs', permission: 'repo-code:rw', label: '图片' },
        files: { path: '/-/upload/files', permission: 'repo-notes:rw', label: '附件' }
    };

    // 清理文件名：接口不允许 < > : \ / | ? * % 和连续 `..`；
    // 且 CNB 会把附件名截短（google_pro_6_12_24.zip -> _24.zip），故主名里的 . - _ 一律去掉
    function sanitizeFileName(raw) {
        let name = String(raw == null ? '' : raw);
        try { name = decodeURIComponent(name); } catch (_) {}
        name = name.split(/[\\/]/).pop().replace(/[<>:"\\/|?*%\x00-\x1f]/g, '');
        const dot = name.lastIndexOf('.');
        const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[._-]+/g, '').trim();
        const ext = dot > 0 ? name.slice(dot).replace(/[^0-9a-zA-Z.]+/g, '') : '';
        return (base || 'file').slice(0, 100) + ext;
    }

    // 1. 获取上传凭证（kind: 'imgs' | 'files'）
    function requestAssetUploadToken(kind, fileName, fileSize, callback) {
        const conf = ASSET_UPLOAD_KINDS[kind] || ASSET_UPLOAD_KINDS.imgs;
        if (!CONFIG.repoPath || !CONFIG.accessToken) {
            if (typeof callback === 'function') callback(null, '请先配置仓库路径和访问令牌');
            return;
        }

        const name = sanitizeFileName(fileName);
        const body = (kind === 'files')
            ? { name: name, size: fileSize }
            : { name: name, size: fileSize, ext: {} };

        apiRequest({
            method: 'POST',
            path: conf.path,
            accept: 'application/json',
            data: body
        }, function(err, resp, response) {
            if (err) {
                let errorMsg = err.message;
                // 特殊处理权限错误 (errcode: 7)
                if (resp && resp.errcode === 7 && String(resp.errmsg || '').includes('票据授权范围')) {
                    errorMsg = `访问令牌缺少 ${conf.permission} 权限`;
                    notifyUser(`${conf.label}上传失败：访问令牌缺少 ${conf.permission} 权限`, 5000);
                }
                console.error(`[CNB Issue] ${conf.label}上传凭证失败:`, response ? response.status : '', resp || errorMsg);
                if (callback) callback(null, errorMsg);
                return;
            }
            if (callback) callback(resp, null);
        });
    }

    // 兼容旧调用
    function requestUploadToken(fileName, fileSize, callback) {
        requestAssetUploadToken('imgs', fileName, fileSize, callback);
    }
    function requestFileUploadToken(fileName, fileSize, callback) {
        requestAssetUploadToken('files', fileName, fileSize, callback);
    }

    // 2. 上传二进制到 OSS（label 仅用于日志/错误文案）
    function uploadBlobToOss(uploadInfo, fileData, label, callback) {
        if (!uploadInfo?.upload_url) {
            if (callback) callback(null, '上传凭证无效');
            return;
        }

        // 构建请求头，并附加凭证里的表单参数
        const headers = {
            'Content-Type': (fileData && fileData.type) || 'application/octet-stream'
        };
        if (uploadInfo.form) {
            Object.entries(uploadInfo.form).forEach(([key, value]) => {
                if (key.toLowerCase() !== 'file') {
                    headers[key] = value;
                }
            });
        }

        GM_xmlhttpRequest({
            method: 'PUT',
            url: uploadInfo.upload_url,
            headers: headers,
            data: fileData,
            binary: (fileData instanceof Blob),
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    const finalUrl = buildAssetUrl(uploadInfo);
                    if (callback) callback(finalUrl, finalUrl ? null : `上传成功但未获取到${label}链接（凭证响应：${JSON.stringify(uploadInfo).slice(0, 300)}）`);
                    return;
                }

                let errorMsg = `HTTP ${response.status}`;
                let detail = '';
                try {
                    detail = response.responseText || '';
                    if (detail) {
                        const err = JSON.parse(detail);
                        if (err?.message) errorMsg = err.message;
                    }
                } catch (_) {}
                if (detail) errorMsg = `${errorMsg}（${String(detail).slice(0, 300)}）`;
                console.error(`[CNB Issue] ${label} PUT 上传失败:`, response.status, detail);

                if (callback) callback(null, errorMsg);
            },
            onerror: function() {
                if (callback) callback(null, `${label}上传失败`);
            }
        });
    }

    // 兼容旧调用
    function uploadImageToOss(uploadInfo, fileData, callback) {
        uploadBlobToOss(uploadInfo, fileData, '图片', callback);
    }
    function uploadFileToOss(uploadInfo, fileData, callback) {
        uploadBlobToOss(uploadInfo, fileData, '附件', callback);
    }

    // 3. 解析 base64 数据为 Blob（返回 null 表示不是 base64 或解析失败）
    function decodeBase64Blob(dataUrl) {
        const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) return null;
        try {
            const byteString = atob(matches[2]);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }
            return new Blob([ab], { type: matches[1] });
        } catch (_) {
            return null;
        }
    }

    // 计算下载时的 Referer：使用目标资源自身的源，兼容防盗链站点
    function refererForUrl(url) {
        try {
            return new URL(url, location.href).origin + '/';
        } catch (_) {
            return location.href;
        }
    }

    // 3.1 下载远程二进制（图片 / 附件通用）
    //   - 用 GM_xmlhttpRequest 绕过 CORS，并自动携带目标域 Cookie（保证登录态）
    //   - 部分站点（如 linux.do 的 /uploads/short-url）会 302 跳到 CDN 直链，
    //     而 Tampermonkey 在跨域跳转后会丢弃自定义 Referer，触发 CDN 防盗链返回 403。
    //     这里对跳转后的最终地址带 Referer 直连重试一次，避免因丢失登录/来源信息而失败。
    function downloadRemoteBinary(url, callback) {
        if (!url) {
            if (callback) callback(null, '无效的下载地址');
            return;
        }

        const referer = refererForUrl(url);

        const request = (target, isRetry) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: target,
                headers: { 'Referer': referer },
                responseType: 'blob',
                anonymous: false, // 显式携带 Cookie，确保登录态可用
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300 && response.response) {
                        if (callback) callback(response.response, null);
                        return;
                    }

                    const finalUrl = response.finalUrl;
                    // 跨域跳转导致 Referer 丢失：直连最终地址并补齐 Referer 重试一次
                    if (!isRetry && finalUrl && finalUrl !== target) {
                        console.warn('[CNB Issue] 下载被拦截（HTTP ' + response.status + '），尝试直连跳转地址重试:', finalUrl);
                        request(finalUrl, true);
                        return;
                    }

                    let msg = `HTTP ${response.status}`;
                    if (response.status === 401 || response.status === 403) {
                        msg += '（下载需要登录，或资源存在防盗链保护）';
                    }
                    if (callback) callback(null, msg);
                },
                onerror: function() {
                    if (callback) callback(null, '下载失败（网络错误）');
                }
            });
        };

        request(url, false);
    }

    // 3.2 获取图片数据（从 URL 或 base64）
    function fetchImageData(imageUrl, callback) {
        if (imageUrl.startsWith('data:')) {
            const blob = decodeBase64Blob(imageUrl);
            if (callback) callback(blob, blob ? null : 'base64 解析失败');
            return;
        }
        downloadRemoteBinary(imageUrl, callback);
    }

    // 3.3 下载远程文件（附件）数据：同源优先用 fetch 携带登录 Cookie，失败再回退 GM_xmlhttpRequest
    function fetchRemoteFileData(fileUrl, callback) {
        if (!fileUrl) {
            if (callback) callback(null, '无效的文件地址');
            return;
        }
        if (fileUrl.startsWith('data:')) {
            const blob = decodeBase64Blob(fileUrl);
            if (callback) callback(blob, blob ? null : 'base64 解析失败');
            return;
        }

        let sameOrigin = false;
        try {
            sameOrigin = new URL(fileUrl, location.href).origin === location.origin;
        } catch (_) {}

        // 同源请求用 credentials: 'same-origin'：
        //   - 初始同源请求（如 linux.do 的 /uploads/short-url）会携带登录 Cookie，满足“需登录”的下载
        //   - 若该请求 302 跳到跨域 CDN 直链，跨域这一跳不再带凭证，
        //     可避免 CDN 返回空 Access-Control-Allow-Credentials 时与 credentials: 'include' 冲突被 CORS 拦截
        if (sameOrigin && typeof fetch === 'function') {
            fetch(fileUrl, { credentials: 'same-origin', redirect: 'follow' })
                .then(res => {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.blob();
                })
                .then(blob => {
                    if (blob && blob.size > 0) {
                        if (callback) callback(blob, null);
                    } else {
                        downloadRemoteBinary(fileUrl, callback);
                    }
                })
                .catch(() => {
                    downloadRemoteBinary(fileUrl, callback);
                });
            return;
        }

        downloadRemoteBinary(fileUrl, callback);
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

    // 判断链接是否指向可下载的附件文件
    function isDownloadableFileUrl(url) {
        if (!url) return false;
        const clean = String(url).split('#')[0].split('?')[0].toLowerCase();
        return /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|pdf|doc|docx|xls|xlsx|ppt|pptx|csv|txt|md|json|xml|apk|exe|msi|dmg|iso|mp3|mp4|mov|avi|mkv|wav|flac|log|torrent)$/.test(clean);
    }

    // 从 Markdown 中提取附件链接（[名称](url)，排除图片 ![]()）
    function extractFileLinksFromMarkdown(markdown) {
        const files = [];
        if (!markdown) return files;
        const seen = new Set();
        const regex = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
        let match;
        while ((match = regex.exec(markdown)) !== null) {
            if (match[1] === '!') continue; // 图片链接，跳过
            const url = match[3];
            if (!isDownloadableFileUrl(url)) continue;
            if (seen.has(url)) continue;
            seen.add(url);
            let name = (match[2] || '').trim();
            if (!name) {
                try {
                    name = decodeURIComponent(url.split('?')[0].split('/').pop() || '');
                } catch (_) {
                    name = url;
                }
            }
            files.push({ url, name });
        }
        return files;
    }

    // 格式化文件大小
    function formatFileSize(bytes) {
        if (bytes === null || bytes === undefined) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    }

    // 从上传凭证响应中解析最终资源链接（图片 / 附件通用）
    function buildAssetUrl(uploadInfo) {
        if (!uploadInfo) return null;
        const direct = uploadInfo.asset_link || uploadInfo.assets?.link || uploadInfo.assets?.url || uploadInfo.link;
        if (direct && /^https?:\/\//.test(direct)) return direct;
        const p = uploadInfo.assets?.path || uploadInfo.path;
        if (p) {
            if (/^https?:\/\//.test(p)) return p;
            return p.includes(CONFIG.repoPath) ? `${CONFIG.webBase}${p}` : `${CONFIG.webBase}/${CONFIG.repoPath}${p}`;
        }
        return null;
    }

    // 8. 批量上传附件并替换/追加 Markdown 中的链接
    //   files: [{ name, href }] 远程链接 或 [{ name, blob }] 本地文件
    function uploadFilesAndReplace(markdown, files, callback) {
        if (!files || files.length === 0) {
            if (callback) callback(markdown, []);
            return;
        }

        const errors = [];
        const results = new Array(files.length);
        let remaining = files.length;

        const done = () => {
            remaining--;
            if (remaining > 0) return;

            let updated = markdown;
            const appended = [];
            files.forEach((f, i) => {
                const r = results[i];
                if (!r || !r.newUrl) return;
                if (r.isLocal) {
                    appended.push(`[${r.name}](${r.newUrl})`);
                } else if (f.href) {
                    updated = updated.split(`](${f.href})`).join(`](${r.newUrl})`);
                }
            });
            if (appended.length > 0) {
                updated = updated.replace(/\s+$/, '') + '\n\n' + appended.join('\n') + '\n';
            }
            errors.forEach(e => console.error('[CNB Issue] 附件处理失败:', e.src, '->', e.error));
            if (callback) callback(updated, errors);
        };

        const handleBlob = (index, f, blob) => {
            const isLocal = !!f.blob;
            const fileName = f.name || 'file';
            if (!blob) {
                errors.push({ src: f.href || fileName, error: '获取文件失败' });
                results[index] = { name: fileName, isLocal, newUrl: null };
                done();
                return;
            }
            requestFileUploadToken(fileName, blob.size, (uploadInfo, tokenError) => {
                if (tokenError || !uploadInfo) {
                    errors.push({ src: f.href || fileName, error: tokenError || '获取上传凭证失败' });
                    results[index] = { name: fileName, isLocal, newUrl: null };
                    done();
                    return;
                }
                uploadFileToOss(uploadInfo, blob, (newUrl, uploadError) => {
                    if (uploadError || !newUrl) {
                        errors.push({ src: f.href || fileName, error: uploadError || '上传文件失败' });
                        results[index] = { name: fileName, isLocal, newUrl: null };
                    } else {
                        results[index] = { name: fileName, isLocal, newUrl };
                    }
                    done();
                });
            });
        };

        files.forEach((f, index) => {
            if (f.blob) {
                handleBlob(index, f, f.blob);
            } else if (f.href) {
                fetchRemoteFileData(f.href, (blob, error) => {
                    if (error || !blob) {
                        errors.push({ src: f.href, error: error || '获取文件失败' });
                        results[index] = { name: f.name || f.href, isLocal: false, newUrl: null };
                        done();
                        return;
                    }
                    handleBlob(index, f, blob);
                });
            } else {
                errors.push({ src: f.name || '', error: '无效的附件' });
                results[index] = { name: f.name || '', isLocal: false, newUrl: null };
                done();
            }
        });
    }

    // 读取持久化配置
    function loadPersistedConfig() {
        try {
            if (typeof GM_getValue !== 'function') return;

            // 先恢复已保存的区域，并按该区域读取对应的仓库路径与访问令牌
            applyRegion(GM_getValue('cnbRegion', CONFIG.region || 'cn'), false);

            const tags = GM_getValue('cnbTags', []);
            const hk = GM_getValue('cnbHotkey', START_HOTKEY);
            const hkEnabled = GM_getValue('cnbHotkeyEnabled', HOTKEY_ENABLED);
            const uploadEnabled = GM_getValue('cnbUploadEnabled', true);
            const uploadFilesEnabled = GM_getValue('cnbUploadFilesEnabled', true);

            if (Array.isArray(tags)) SAVED_TAGS = tags;
            if (hk) START_HOTKEY = normalizeHotkeyString(hk);
            HOTKEY_ENABLED = !!hkEnabled;
            CONFIG.uploadEnabled = !!uploadEnabled;
            CONFIG.uploadFilesEnabled = !!uploadFilesEnabled;
        } catch (_) {}
    }

    // 初始化
    function init() {
        // 仅在顶层文档注入 UI：@match 匹配所有页面，若不做限制，页面内的每个
        // iframe/webview 都会各自生成一个贴边 Dock，从 iframe 自身左边缘滑出，
        // 视觉上就像"按钮组出现在页面中间"。（同时脚本已加 @noframes 双保险）
        let isTopFrame = true;
        try { isTopFrame = (window.top === window.self); } catch (_) { isTopFrame = false; }
        if (!isTopFrame) return;

        injectStyles();
        injectCommonStyles();
        loadPersistedConfig();
        createFloatingButton();
        document.addEventListener('keydown', globalHotkeyHandler, true);
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();