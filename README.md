<h1 align="center">经管科研站</h1>

<p align="center">每天从 UTD24、FT50 和 ABS 3/4 星期刊收录新上线的论文，按研究领域归类、读摘要打分，给经管研究生出一份日报。</p>

<p align="center"><sub>第一个版本（MVP）。基于 MIT 许可的开源引擎搭建，保留上游版权归属。</sub></p>

## 它做什么

1. **收录**：每 3 小时按 ISSN 向 Crossref 查一次，把收录范围内各期刊新登记的论文存下来（标题、作者、出版日期、摘要、DOI）。勘误、目录、编委页这类不是论文的条目直接剔除。
2. **归类**：模型读标题和摘要，判断是不是经管相关的研究，再分到经济学、金融、会计、管理学、营销、信息系统，分不进的放“交叉与其他”；同时标上论文类型（实证、实验、理论、方法与数据、综述）和话题标签。
3. **打分**：从五个方面独立打两次 0–100 分——问题与贡献、新颖性、证据强度、对经管研究生的相关性、可用性。评分时模型看不到期刊名字。
4. **精选**：期刊等级只决定门槛。UTD24 和 FT50 期刊的论文 60 分入选，ABS 3/4 星期刊 65 分。入选的由模型写中文标题、摘要和推荐理由。
5. **出刊**：每天 08:00（北京时间）出日报，周一出周报，每月 1 日出月报；另有网站、RSS、公开 API 和 MCP。

## 现在的范围

| 已经有 | 还没有 |
|---|---|
| 452 本英文期刊（UTD24、FT50、ABS 3/4 星），899 个 ISSN | 85 本 FMS 中文期刊：Crossref 里查不到，要逐本配官网的“最新目录”页 |
| 按领域、论文类型、话题浏览和筛选 | 按被引次数、下载量排的“热度”：需要另写定时任务记录被引快照 |
| 中文标题、摘要、推荐理由 | 邮件、飞书等推送渠道 |
| 日报、周报、月报 | 用人工标注的样本校准评分和门槛（现在是一组起点值） |

已知限制：

- Elsevier 旗下期刊在 Crossref 里基本不带摘要。只有标题的论文会先等待补充摘要或正文，不进入评分和精选。下一步用 OpenAlex 按 DOI 补摘要；也可在 `.env` 配免费的 `JINA_API_KEY`，让引擎尝试从原文落地页补摘要。
- 首次采集只回溯近 3 天，通常是数百篇；之后每 3 小时读取游标前 3 天至当天，靠 DOI 去重。暂停超过 21 天后再启动不会自动补更早的论文。
- 期刊分级暂按“UTD24/FT50 一档、ABS 3/4 星一档”，检索式没有区分 3 星、4 星和 4*。
- 分类和精选标准是第一版，欢迎提意见。
- 使用规则和隐私说明已按论文站改写，但运营主体、生效日期和联系方式仍待公开部署前填写；模板不是正式法律意见。

## 跑起来

需要 [Docker](https://docs.docker.com/get-started/get-docker/)、[Node.js 24](https://nodejs.org/en/download)（生成配置要用），和一个 OpenAI 兼容的模型 API Key（DeepSeek、千问、智谱都可以）。

```bash
git clone https://github.com/confidentxin/econ-mgmt-paper-daily.git
cd econ-mgmt-paper-daily
node scripts/init-env.ts --llm-key <你的模型 API Key>
docker compose up -d --build
```

打开 <http://localhost:3000>。后台在 `/admin`，管理员密码在 `.env` 的 `ADMIN_PASSWORD` 里。期刊信源在首次启动时导入；worker 每 3 小时取一次 Crossref，取到的论文在后台“信源”页能看到处理进度。

想只看界面、不花钱：把 `.env` 里的 `COLLECT_ENABLED` 和 `MODEL_CALLS_ENABLED` 改成 `false`，启动后就不取论文、不调模型。

模型费用取决于实际论文量、材料完整度和调用次数；可以先只跑采集，再用小批量样本估算。想省，可以在 `.env` 里给预筛和评分步骤单独配便宜的模型（见 `.env.example` 的“每一步单独换模型”）。

不用 Docker、服务器在中国大陆、要配域名，见[部署](docs/deploy.md)。

## 目录

| 位置 | 内容 |
|---|---|
| [`modules/literature/`](modules/literature/) | 本站自己的部分：Crossref 采集、期刊名录、信源生成脚本 |
| [`industry/`](industry/) | 分类与标签（`taxonomy.ts`）、主题页（`topics.json`）、精选标准（`prompts/`）、门槛（`selection.ts`）、信源（`sources.json`，由脚本生成） |
| [`site/`](site/) | 站名与文案（`site.ts`）、品牌图标、使用规则与隐私说明、对外接口文件、更新日志 |
| 其余 | 上游开源引擎，见[框架说明](docs/framework.md)和[架构](docs/architecture.md) |

改精选标准，主要改 `industry/prompts/selection-score.md`（五个方面的定义、该给高分的和该压住的）和 `industry/selection.ts`（门槛）。改了之后用 `scripts/eval-selection.ts` 在自己标注的样本上重跑，见[精选与校准](docs/selection.md)。

## 检查

```bash
npm run typecheck
npm run test:standalone
DATABASE_URL=postgres://…/xxx_test npm test     # 库名必须以 _test 或 _ci 结尾
npm run build -w @aihot/web
npm run test:web
```

浏览器测试需要 Playwright 的 Chromium 和 WebKit。备份集成测试需要 `pg_dump` 和 `pg_restore`，本机未安装时会跳过；依赖 POSIX 信号的关闭测试在 Windows 上跳过，在 Linux/macOS 和项目的 Docker 环境中运行。

## 许可

代码使用 [MIT 许可证](LICENSE)，上游版权归属见 [NOTICE](NOTICE)；上游项目的名字和 Logo 不纳入本站品牌，本站使用自己的名字和图标。字体许可见 [NOTICE](NOTICE)。论文的标题、作者和摘要来自 Crossref 的公开元数据，论文原文版权归各期刊与作者所有。
