# GitHub 一键存飞书

这个项目现在支持两种模式：

1. 浏览器扩展直连 GitHub、模型 API、飞书 API
2. 浏览器扩展 / Tampermonkey 调本地服务中转

如果你现在想要的是“一个未打包扩展，装上后点图标弹窗配置，再一键写入飞书”，优先用扩展直连模式。

## 当前能力

- 识别当前 GitHub 仓库页
- 采集仓库标题、链接、描述、语言、星标、Fork、作者、Topics、主页、更新时间
- 调用模型 API 生成中文简介、分类、标签
- 写入飞书多维表格
- 扩展弹窗内保存配置
- GitHub 仓库页右下角悬浮按钮
- 同时保留本地服务模式作为更安全备选

## 目录

- [`extension`](./extension)：浏览器扩展
- [`server.mjs`](./server.mjs)：本地中转服务
- [`tampermonkey/github-to-feishu.user.js`](./tampermonkey/github-to-feishu.user.js)：油猴版本

## 安装扩展

1. 打开 Chrome / Edge 扩展管理页
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 [`extension`](./extension) 目录

装好后，点击浏览器工具栏里的扩展图标，就会看到弹窗。

## 扩展模式说明

### 模式 1：纯扩展直连 API

这是你现在要的高级模式。

- 不需要启动本地服务
- 所有配置都在扩展弹窗里填写
- 点击“保存当前项目”会直接请求 GitHub、模型 API、飞书

注意：

- 密钥会保存在浏览器扩展的本地存储 `chrome.storage.local`
- 只建议个人电脑自用
- 不建议把这个扩展目录同步到公开仓库、网盘共享目录或团队设备

### 模式 2：本地服务中转

- 扩展里只存 `serverUrl`
- 真正的密钥放在本地 `.env`
- 安全性更好

## 推荐的飞书字段

先在飞书多维表格里创建这些列，字段名尽量和下面保持一致：

| 字段名 | 类型 |
| --- | --- |
| 标题 | 单行文本 |
| 链接 | 单行文本 |
| 简介 | 多行文本 |
| 分类 | 单行文本 |
| 星标 | 数字 |
| Fork | 数字 |
| 语言 | 单行文本 |
| Topics | 多行文本 |
| 作者 | 单行文本 |
| 仓库名 | 单行文本 |
| 主页 | 单行文本 |
| 更新时间 | 单行文本 |
| 来源 | 单行文本 |

`分类` 这里建议先用单行文本，不要第一版就做单选，能少很多字段格式兼容问题。
如果你不确定字段类型，第一版也可以先全部建成文本列。扩展现在会优先读取飞书字段类型并自动适配；如果读取不到，会退回到更保守的文本写入方式。

## 纯扩展模式怎么配

打开扩展弹窗后：

1. 把“运行模式”切到“纯扩展直连 API（高级）”
2. 点击“打开设置”
3. 填 GitHub、OpenAI、飞书参数
4. 点击“保存设置”
5. 点击“测试飞书鉴权”
6. 打开任意 GitHub 仓库页，点击“保存当前项目”

装好扩展并刷新 GitHub 仓库页后，右下角也会出现悬浮按钮 `存到飞书`。

### 需要填写的配置

- `GitHub Token`
- `模型 API Base URL`
- `模型 API Key`
- `模型名称`
- `飞书 App ID`
- `飞书 App Secret`
- `飞书多维表格 App Token`
- `飞书数据表 Table ID`

其中 `GitHub Token` 可选，不填也能抓公开仓库，但更容易遇到 GitHub API 限流。

## 飞书配置怎么拿

### 1. App ID / App Secret

做法：

1. 打开 [飞书开放平台](https://open.feishu.cn/app?lang=zh-CN)
2. 创建“企业自建应用”
3. 进入应用详情页
4. 在“凭证与基础信息”里查看 `App ID` 和 `App Secret`

我查到的官方飞书内容页里，2026 年 3 月可见的说明也明确提到创建企业自建应用后，需要获取 `App ID`、`App Secret` 供后续部署使用。[官方示例内容](https://www.feishu.cn/content/7290834975460655106)

### 2. 多维表格 App Token

这个一般直接从多维表格地址里拿。

常见链接会长这样：

```text
https://xxx.feishu.cn/base/bascnXXXXXXXXXXXX?table=tblYYYYYYYYYYYY&view=vewZZZZZZZZZZZZ
```

这里：

- `/base/` 后面的 `bascnXXXXXXXXXXXX` 就是 `App Token`
- 它也是飞书多维表格 API 路径里的 `app_token`

这是我根据飞书多维表格页面 URL 结构和官方 OpenAPI 路径做的对应推断。官方 API 文档里的新增记录接口也使用了 `/bitable/v1/apps/{app_token}/tables/{table_id}/records` 这种参数命名。[新增记录接口](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create)

### 3. Table ID

还是看同一个 URL。

如果链接里有：

```text
?table=tblYYYYYYYYYYYY
```

那 `tblYYYYYYYYYYYY` 就是 `Table ID`。

如果你看不到 `table=` 参数，先切到目标数据表，再复制当前地址，通常就能看到。

### 4. 让应用有权限访问这个多维表格

这一步很关键，不然即使 `App ID`、`Secret` 对，也会报权限错误。

你需要做两件事：

1. 在飞书开放平台里给应用打开多维表格相关权限
2. 在多维表格里把这个应用添加进去

我查到的飞书官网内容页里，说明了：

- 在开放平台的“权限管理”中搜索并打开 `bitable:app`、`bitable:app:readonly`、`base:record:retrieve`
- 开通权限后，需要到“版本管理与发布”发布新版本
- 在多维表格里通过“... -> 更多 -> 添加文档应用”把目标应用加进去

来源是飞书官网这篇关于“在页面中展示和修改飞书多维表格数据”的内容页。[官方内容页](https://www.feishu.cn/content/137710114294)

补一句：这篇内容主要是低代码场景，但里面的权限开通和“添加文档应用”步骤，对你现在这个 OpenAPI 方案也有直接参考价值。

### 5. tenant_access_token 是怎么来的

扩展会自动用 `App ID` 和 `App Secret` 去调用飞书的 `tenant_access_token/internal` 接口，不需要你手动填 `tenant_access_token`。

对应官方接口在这里：

- [获取 tenant_access_token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)

## GitHub Token 怎么拿

如果你只抓公开仓库，可以先不填。

如果你想更稳一点：

1. 打开 GitHub 个人设置里的 Developer settings
2. 创建 Personal Access Token
3. 给只读公开仓库所需的最小权限
4. 填到扩展的 `GitHub Token`

## 模型 API 怎么配

- `模型 API Base URL`：默认 `https://api.openai.com/v1`
- `模型 API Key`：你的模型平台 Key
- `模型名称`：比如 `gpt-4o-mini`

当前扩展支持的是“OpenAI 兼容协议”接口，也就是会请求：

```text
{Base URL}/chat/completions
```

所以像这些平台通常都能直接接：

- OpenAI
- OpenRouter
- 硅基流动
- 火山方舟里提供 OpenAI 兼容网关的模型
- One API / New API 这类聚合网关

如果你要接的是完全不兼容 OpenAI 协议的厂商接口，那就还需要再加一层适配。

## 本地服务模式

如果你后面想把密钥挪出扩展：

1. 复制 `.env.example` 为 `.env`
2. 填上模型 API、GitHub、飞书配置
3. 运行：

```powershell
node server.mjs
```

然后在扩展里切回“本地服务中转”，填 `http://127.0.0.1:8787` 就行。

## 官方链接

- GitHub REST API 仓库接口: <https://docs.github.com/en/rest/repos/repos>
- 飞书获取 tenant_access_token: <https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal>
- 飞书多维表格新增记录: <https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create>
- OpenAI API 文档: <https://platform.openai.com/docs/api-reference>
