# CNB Issue 网页内容收藏工具

一个 Tampermonkey（油猴）脚本，可在任意网页上选择页面区域，一键将选中内容从 HTML 转为 Markdown，并按"页面信息 + 选择的内容"格式展示，支持通过 CNB 接口直接创建 Issue存储在CNB中。

![](https://raw.githubusercontent.com/IIIStudio/CNBIssue/main/image/18.png)

B站演示：https://www.bilibili.com/video/BV1AocxzPEr3/

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
  - 权限范围设置为 `repo-issue:rw,repo-contents:rw,repo-notes:rw`

### 可选设置
- **标签管理**：先在仓库的 `-/labels` 中设置标签，然后在工具中输入标签名称
- **快捷键**：可自定义激活工具的快捷键（默认关闭）
- **剪贴板**：设置 Issue ID 启用剪贴板功能

## 剪贴板功能

### 启用方法
在设置中填写剪贴板位置（Issue 编号），例如：2
对应格式：`https://cnb.cool/IIIStudio/Greasemonkey/CNBIssue/-/issues/2`

## 更新日志
### 版本 1.5.2
- 添加收藏功能

### 版本 1.5.1
- 修复修改Issue 之后标签问题

### 版本 1.5
- 添加支持修改Issue 添加评论

### 版本 1.4.7
- 添加选择微博截取图片上传（留下罪证）无法异步加载，只能点击微博内页选择，首页截取位置会有问题，可以直接点击时间跳转内页

### 版本 1.4.4
- 修复图片链接处理
- 修改UI
- 添加支持剪贴板多个IssueID

### 版本 1.3.4
- 修复多层 div 不显示 h 标签问题

### 版本 1.3.3  
- 优化 linux.do 图片链接处理
- 删除标签图片显示

### 版本 1.3.2
- 修复 CNB 跳转功能

### 版本 1.3.1
- 添加剪贴板代码多行折叠功能

### 版本 1.3.0
- 新增剪贴板功能
- 支持拖拽和固定位置

### 版本 1.2.5
- 添加 Ctrl + 左键 多选功能

### 版本 1.2.4
- 添加 CNB URL 安全拦截跳转

### 版本 1.2.3
- 修改按键默认隐藏

### 版本 1.2.2
- 添加列表点击复制功能（复制标题与内容并转换为 MD）
- 修复标题过长问题（最长 45 个字符）

### 版本 1.2.1
- 添加任务列表显示（仅显示完成状态）
- 添加创建完成 Issue 按钮