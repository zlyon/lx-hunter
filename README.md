# 音源猎手 (LX Source Hunter)

Songloft (洛雪音乐宿主) JS 插件：GitHub 音源爬取、沙箱可用性检测、多选灌入洛雪音源插件并支持一键撤回。

![版本](https://img.shields.io/badge/version-1.4.17-blue) ![许可](https://img.shields.io/badge/license-MIT-green)

## 功能

**源库**
- 爬取：扫描 12 个内置仓库 + 自定义仓库，自动提取 `.js` 音源候选链接
- 去重：以 `仓库::路径` 为主键入库，重复爬取不会膨胀
- 检测：基础探活 → 疑似音源识别 → jsenv 沙箱深度检测（真实测试歌曲逐平台发起 `musicUrl` 请求 → Range 探测 + 音频魔数校验，假链接/试听片段无法通过）
- 导出 JSON 备份

**灌入**
- 实测可用的音源列表，平台红绿灯（绿=可用 / 红=不可用 / 灰=未检测）
- 多选勾选 → 一键灌入洛雪音源插件并启用，自动记录洛雪侧音源 id
- 一键撤回：调用洛雪插件的删除接口，移除本插件灌入的音源（失效后清理用）

**设置**
- 爬取代理 / raw 加速镜像（内置 jsDelivr 自动兜底）/ 深度检测开关与单轮上限
- 仓库管理：内置仓库锁定，自定义仓库支持直接粘贴 GitHub 地址

## 安装

**方式一：插件商店（推荐）**

Songloft → 设置 → JS 插件管理 → 插件商店 → 管理订阅源 → 添加：

```
https://raw.githubusercontent.com/zlyon/lx-hunter/main/registry.json
```

**方式二：手动上传**

从 [Releases](https://github.com/zlyon/lx-hunter/releases) 下载 `lx-hunter-vX.Y.Z.jsplugin.zip`，在 Songloft 插件管理页上传。

## 使用流程

1. 「设置」页按需配置代理/镜像和自定义仓库
2. 「源库」点「开始爬取」→ 自动完成 爬取 → 基础检测 → 深度检测（一轮需几分钟）
3. 「灌入」页勾选想要的可用源 →「灌入所选」
4. 音源失效后：深度检测复跑 →「灌入」页勾选失效项 →「撤回所选」

## 注意事项

- 需要宿主已安装「洛雪音源」(lxmusic) 插件，灌入/撤回才能生效
- 权限仅申请 `storage` + `jsenv`
- 未认证 GitHub API 限速 60 次/小时（12 个内置仓库每轮足够）
- 插件与洛雪音源插件互相独立，卸载互不影响

## License

MIT
