# GitHub -> Feishu Collector

一款浏览器扩展，用来把当前 GitHub 仓库的信息一键采集到飞书多维表格。

插件会在 GitHub 仓库页注入悬浮按钮，也提供扩展弹窗。点击后会读取仓库信息，调用自定义模型接口生成中文简介与分类，再写入飞书多维表格。

## 功能

- GitHub 仓库页一键采集
- 自动获取标题、链接、简介、作者、语言、星标、Fork、Topics、更新时间等信息
- 支持自定义模型接口，按 OpenAI 兼容 `chat/completions` 协议调用
- 支持飞书多维表格写入、字段读取、字段映射、智能预匹配
- 支持识别飞书多维表格原始链接和知识库链接
- 支持本地去重，避免重复写入

## 安装

1. 打开 Chrome 或 Edge 扩展管理页
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择项目中的 [`extension`](./extension) 目录

## 快速开始

1. 准备一份飞书多维表格
2. 在扩展的“模型”页填写模型地址、API Key、模型名称
3. 在“飞书”页填写 `App ID`、`App Secret`
4. 粘贴多维表格链接，自动识别 `App Token`、`Table ID` 并读取字段
5. 打开任意 GitHub 仓库页，点击悬浮按钮或弹窗里的“保存当前项目”

## 模板文件

如果希望给其他人直接使用，推荐先导入模板再开始配置。

- [用户使用说明](./README-%E7%BB%99%E7%94%A8%E6%88%B7%E7%9C%8B%E7%9A%84.md)
- [Excel 模板](./templates/github-feishu-template.xlsx)
- [CSV 模板](./templates/github-feishu-template.csv)
- [字段说明](./templates/%E5%AD%97%E6%AE%B5%E8%AF%B4%E6%98%8E.md)

## 飞书配置说明

需要准备这些信息：

- `App ID`
- `App Secret`
- 多维表格链接

扩展支持两种链接：

- `/base/bas...` 原始多维表格链接：可直接识别 `App Token` 和 `Table ID`
- `/wiki/...?...table=tbl...` 知识库链接：会先提取 `node_token` 和 `Table ID`，再通过 Wiki API 解析真实的 `App Token`

## 模型配置说明

当前版本支持 OpenAI 兼容接口，请填写：

- 接口地址，例如 `https://api.openai.com/v1`
- API Key
- 模型名称，例如 `gpt-4o-mini`

扩展会请求：

```text
{Base URL}/chat/completions
```

## 项目结构

- [`extension`](./extension)：浏览器扩展主体
- [`templates`](./templates)：飞书模板和字段说明
- [`README-给用户看的.md`](./README-%E7%BB%99%E7%94%A8%E6%88%B7%E7%9C%8B%E7%9A%84.md)：面向最终使用者的安装说明

## 注意事项

- 插件密钥保存在浏览器扩展的本地存储中
- 更适合个人设备或受信环境使用
- 如果删除了飞书中的旧记录，插件会在下次采集时自动复核并刷新本地去重缓存

## 版本

当前扩展版本：`0.8.16`
