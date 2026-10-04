# CNB Issue 网页内容收藏工具

一个 Tampermonkey（油猴）脚本，可在任意网页上选择页面区域，一键将选中内容从 HTML 转为 Markdown，并按"页面信息 + 选择的内容"格式展示，支持通过 CNB 接口直接创建 Issue存储在CNB中。

![](https://raw.githubusercontent.com/IIIStudio/CNBIssue/main/image/18.png)

B站演示：https://www.bilibili.com/video/BV1AocxzPEr3/

把部分作用在CNB上面的移除到 https://cnb.cool/IIIStudio/Code/Greasemonkey/CNB 了

## 功能特点

- 🔍 **智能区域选择** - 可视化选择网页任意区域
- 📝 **HTML 转 Markdown** - 支持链接、图片、代码块、标题、列表、表格、引用等常见结构
- 🚀 **一键创建 Issue** - 直接通过 CNB 接口提交到指定仓库
- 💬 **评论与修改** - 可对已有 Issue 添加评论或修改内容，评论同样支持附件
- 📎 **附件上传** - 支持选择本地文件（zip、pdf、log 等），或自动识别选中内容中的附件链接，创建 Issue / 评论时自动上传到 CNB 并插入链接
- 🔗 **链接自动补全** - 相对链接（如 `/uploads/xxx.zip`）会按原页面地址补全为绝对链接，避免被误解析为仓库路径
- 📋 **剪贴板功能** - 支持多行代码折叠和常用内容管理
- 🌏 **国内外一键切换** - 在设置面板一键切换「国内 / 国外」服务器，自动切换 API 与站点地址（`api.cnb.cool` ↔ `api.cnb.build`、`cnb.cool` ↔ `cnb.build`），仓库路径与访问令牌两套配置相互独立
- 🔔 **结果提示** - 创建 / 修改 Issue、添加评论完成后，右下角弹出结果提示（可点击标题直达对应 Issue）
- ⚙️ **灵活配置** - 可设置仓库路径、访问令牌、标签等

## 安装与使用

### 安装步骤
1. 在油猴安装 [Tampermonkey 浏览器扩展](https://greasyfork.org/zh-CN/scripts/552006-cnb-issue-%E7%BD%91%E9%A1%B5%E5%86%85%E5%AE%B9%E6%94%B6%E8%97%8F%E5%B7%A5%E5%85%B7)
2. 在安装ScriptCat [ScriptCat](https://scriptcat.org/zh-CN/script-show-page/4421)
3. 在CNB直连（提前是安装过油猴或者ScriptCat）安装 [CNB Issue 区域选择工具脚本](https://cnb.cool/IIIStudio/Code/Greasemonkey/CNBIssue/-/git/raw/main/script.user.js)

### 基本使用
1. 点击侧边栏图标激活工具
2. 在页面上选择目标区域
3. 按回车确认选择或 ESC 取消
4. 查看转换后的 Markdown 内容
5. （可选）点击「添加附件」选择本地文件，或让工具自动识别内容中的附件链接
6. 点击"创建 Issue"提交到 CNB

### 附件与评论
- **添加附件**：在对话框点击「添加附件」选择本地文件（支持 zip、pdf、log、apk 等），创建 Issue / 评论时会自动上传到 CNB，并在正文末尾插入 `[文件名](链接)`。
- **自动识别附件链接**：选中内容中若包含 `/uploads/xxx.zip` 之类的附件链接，会出现「检测到 N 个附件链接」开关，开启后自动下载并转存到 CNB，替换正文中的原链接。
- **添加评论**：勾选「添加评论」并填写 Issue 号，可只给已有 Issue 追加评论（不修改原内容），评论同样可带附件。
- **修改 Issue**：勾选「修改Issue」并填写 Issue 号，可更新已有 Issue 的标题与内容。

> 说明：若附件来自需要登录的站点（如 Discourse 论坛的 `/uploads/short-url/...`），请在**源站页面内**触发工具——脚本会在同源下用你的登录态下载文件，否则可能返回 403 无法转存。

## 配置说明

### 必要设置
在侧边栏设置中配置：
- **仓库路径**：格式为 `owner/repo`，例如 `IIIStudio/Demo`
- **访问令牌**：在 [CNB 个人设置](https://cnb.cool/profile/token) 中创建
  - 选择指定仓库
  - 权限范围设置为 `repo-code:rw,repo-notes:rw,repo-issue:rw,repo-pr:rw`
    - `repo-issue:rw`：创建 / 修改 Issue、设置标签
    - `repo-notes:rw`：添加评论、上传附件
    - `repo-code:rw`：上传图片

### 可选设置
- **标签管理**：先在仓库的 `-/labels` 中设置标签，然后在工具中输入标签名称
- **快捷键**：可自定义激活工具的快捷键（默认关闭）
- **剪贴板**：设置 Issue ID 启用剪贴板功能

### 区域切换（国内 / 国外）
设置面板标题右侧的开关可一键切换服务器区域，默认为「国内」：

| 区域 | API 地址 | 站点地址 |
| --- | --- | --- |
| 国内 | `https://api.cnb.cool` | `https://cnb.cool` |
| 国外 | `https://api.cnb.build` | `https://cnb.build` |

- 切换后立即生效：API 请求、Issue 链接、图片 / 附件资源地址都会使用对应区域的域名。
- 两个区域各自保存**独立配置**：仓库路径、访问令牌、剪贴板位置（Issue 编号）、评论收藏（Issue 编号），切换时互不覆盖。

## 剪贴板功能

### 启用方法
在设置中填写剪贴板位置（Issue 编号），例如：2
对应格式：`https://cnb.cool/IIIStudio/Greasemonkey/CNBIssue/-/issues/2`