# CNB Issue 网页内容收藏工具

一个 Tampermonkey（油猴）脚本，可在任意网页上选择页面区域，一键将选中内容从 HTML 转为 Markdown，并按"页面信息 + 选择的内容"格式展示，支持通过 CNB 接口直接创建 Issue存储在CNB中。

![](https://raw.githubusercontent.com/IIIStudio/CNBIssue/main/image/18.png)

B站演示：https://www.bilibili.com/video/BV1AocxzPEr3/

把部分作用在CNB上面的移除到 https://cnb.cool/IIIStudio/Code/Greasemonkey/CNB 了

## 功能特点

- 🔍 **智能区域选择** - 可视化选择网页任意区域
- 📝 **HTML 转 Markdown** - 支持链接、图片、代码块、标题、列表、表格、引用等常见结构
- 🚀 **一键创建 Issue** - 直接通过 CNB 接口提交到指定仓库
- 📋 **剪贴板功能** - 支持多行代码折叠和常用内容管理
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
5. 点击"创建 Issue"提交到 CNB

## 配置说明

### 必要设置
在侧边栏设置中配置：
- **仓库路径**：格式为 `owner/repo`，例如 `IIIStudio/Demo`
- **访问令牌**：在 [CNB 个人设置](https://cnb.cool/profile/token) 中创建
  - 选择指定仓库
  - 权限范围设置为 `repo-code:rw,repo-notes:rw,repo-issue:rw,repo-pr:rw`（现上传图片需要repo-code:rw权限）

### 可选设置
- **标签管理**：先在仓库的 `-/labels` 中设置标签，然后在工具中输入标签名称
- **快捷键**：可自定义激活工具的快捷键（默认关闭）
- **剪贴板**：设置 Issue ID 启用剪贴板功能

## 剪贴板功能

### 启用方法
在设置中填写剪贴板位置（Issue 编号），例如：2
对应格式：`https://cnb.cool/IIIStudio/Greasemonkey/CNBIssue/-/issues/2`