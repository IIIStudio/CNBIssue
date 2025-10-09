# CNB Issue 区域选择工具

一个 Tampermonkey（油猴）脚本：在任意网页上选择页面区域，一键将选中内容从 HTML 转为 Markdown，按“页面信息 + 选择的内容”的格式展示，并可直接通过 CNB 接口创建 Issue。支持链接、图片、代码块/行内代码、标题、列表、表格、引用等常见结构的 Markdown 转换。

> 其实这是一个捡垃圾的脚本！

> **因为我查看文档api发现展示无法新建标签，所以添加标签只能在CNB添加之后，才能在油猴脚本页面添加。**

**如果是自动化生成网站呢！！！**

请打开：https://cnb.cool/wget/i/issueblog

项目预览：https://api.nocode.host

**演示效果：https://cnb.cool/IIIStudio/Demo/-/issues**


## 设置

插件会在游览器侧边显示

点击设置输入仓库路径 (owner/repo)与访问令牌 (accessToken):

例如：IIIStudio/Demo

访问令牌在：个人设置-访问令牌 https://cnb.cool/profile/token

新建令牌 输入名称 选择指定仓库 常见场景设置为ISSUE & PR 管理。

## 使用方式

可以点击插件选择，选择区域之后回车确定也可以esc取消。

只是设置快捷键，默认是关闭状态。

**标签是需要你在 -/labels 管理标签中先设置好**，然后在设置中输入标签然后回车，这样就可以使用了

然后点击 创建Issue

## 其他玩法

创建一个数据集

数据范围*
IIIStudio/Demo

例如：https://cnb.cool/IIIStudio/DemoPP

通过筛选标签分类。

