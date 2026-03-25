# GitHub -> Feishu Collector

GitHub -> Feishu Collector 是一个浏览器扩展，用来把当前 GitHub 仓库的信息一键采集到飞书多维表格。

扩展会在 GitHub 仓库页提供悬浮按钮和弹窗入口。采集时会读取仓库信息，调用自定义模型接口生成中文简介与分类，再按字段映射写入飞书多维表格。

## 功能特性

- GitHub 仓库页一键采集
- 自动提取标题、链接、简介、作者、语言、星标、Fork、Topics、更新时间等信息
- 支持自定义模型接口，按 OpenAI 兼容 `chat/completions` 协议调用
- 支持飞书字段读取、字段映射、智能预匹配与缺失字段跳过
- 支持识别 `/base/...` 原始多维表格链接与 `/wiki/...` 知识库链接
- 支持本地去重与删除后复核，避免重复写入

## 安装方式

1. 打开 Chrome 或 Edge 扩展管理页
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择项目中的 [`extension`](./extension) 目录

## 快速开始

1. 先准备飞书多维表格
2. 在扩展“模型”页填写接口地址、API Key、模型名称
3. 在扩展“飞书”页填写 `App ID`、`App Secret`
4. 粘贴多维表格链接，让扩展自动识别 `App Token`、`Table ID` 并读取字段
5. 打开任意 GitHub 仓库页，点击悬浮按钮或弹窗里的“保存当前项目”

## 多维表格模板

推荐优先导入模板，再进行飞书配置。

- [Excel 模板](./templates/github-feishu-template.xlsx)
- [CSV 模板](./templates/github-feishu-template.csv)
- [字段说明](./templates/%E5%AD%97%E6%AE%B5%E8%AF%B4%E6%98%8E.md)

说明：

- `XLSX` 模板适合直接导入飞书或 Excel
- `CSV` 模板使用 UTF-8 BOM 编码，兼顾 Excel 打开与导入兼容性
- 字段名保持默认值时，可减少字段映射的手动调整

## 飞书配置

需要准备：

- `App ID`
- `App Secret`
- 多维表格链接

支持的链接类型：

- `/base/bas...` 原始多维表格链接：可直接识别 `App Token` 和 `Table ID`
- `/wiki/...?...table=tbl...` 知识库链接：先提取 `node_token` 与 `Table ID`，再通过 Wiki API 解析真实的 `App Token`

## 模型配置

当前版本支持 OpenAI 兼容接口，请填写：

- 接口地址，例如 `https://api.openai.com/v1`
- API Key
- 模型名称，例如 `gpt-4o-mini`

扩展默认请求：

```text
{Base URL}/chat/completions
```

## 安全说明

- 配置项保存在浏览器扩展的本地存储中
- 仓库已忽略 `.env`、`.env.*`、`*.local`、`*.secret` 等常见敏感文件
- 采集去重会使用本地缓存；如果飞书中删除了旧记录，下次采集会自动复核并刷新缓存

## 项目结构

- [`extension`](./extension)：浏览器扩展主体
- [`templates`](./templates)：飞书模板和字段说明

## 未来计划

项目后续会逐步扩展为通用的信息采集与归档工具，重点方向包括：

- 支持更多内容平台的采集，不只限于 GitHub，也包括微信公众号文章、X / Twitter、Telegram 频道、知乎、掘金、即刻等
- 支持更多页面类型的采集，例如文章、项目、帖子、话题页、合集页与个人主页
- 支持按不同来源生成统一结构的数据，便于沉淀到飞书多维表格中长期管理
- 支持针对不同平台定制摘要、分类、标签与字段映射规则
- 支持扩展到更多目标平台，例如 Notion Database、Airtable、Baserow 等
- 支持历史内容补采、批量采集与定时采集
- 提供更完整的模板、导入导出与安装发布能力，降低团队使用门槛

## 当前版本

`0.8.17`
