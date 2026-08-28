# ragoss — 个人多模态知识库

自建多模态知识检索问答系统:多存储后端(S3 兼容 + WebDAV)→ 双路多模态嵌入(Qwen/DashScope + Google)→ RRF 融合检索 → 自有问答模型(OpenAI / OpenAI Responses / Google / Anthropic 四协议)。

**v1 无重排序模型**(council 结论),但检索管线预留多模态可插拔 rerank 接口(`src/search/rerank/`),默认 no-op。

## 快速开始

```bash
pnpm install
pnpm test                       # 核心逻辑自检(无需网络/key)
cp config.example.json config.json   # 最低限度占位(面板会重写它)
pnpm dev                        # 打开 http://localhost:8787 直接在控制台配存储/模型
```

控制台(根路径 `/`)可配置全部存储与模型(端点、key、模型 id)、测试连通性、立即索引;保存后热生效并写回 `config.json`。公网部署务必设置 `ADMIN_TOKEN` 环境变量(面板合 API 均需携带)。

命令行同样可用:`pnpm index`(增量索引)、`pnpm ask -- "问题"`。

## HTTP API

| 路由 | 说明 |
|---|---|
| `GET /health` | 存活 + 已索引向量数 |
| `POST /index` `{"full": false}` | 增量/全量索引(报告 added/changed/removed/errors) |
| `POST /search` `{"query": "...", "filter": {"storage","mimePrefix","pathPrefix","since"}, "topK", "finalK"}` | 检索 |
| `POST /ask` `{"query": "...", "filter": {...}}` | RAG 问答,返回答案 + 编号来源;图片来源内联进多模态上下文 |

## 配置

见 `config.example.json`:

- **storages[]**:`type: s3`(endpoint/region/bucket/prefix/密钥,兼容阿里云 OSS、R2、COS、B2、MinIO)或 `type: webdav`
- **embeddings[]**:`provider: dashscope`(文本/图/音/视频,如 `multimodal-embedding-one-peace-v1`)或 `provider: google`(文本/图,如 `gemini-embedding-001`);端点/模型/维度可配
- **qa**:`protocol: openai | openai-responses | google | anthropic`,baseUrl/apiKey/model 自配(支持任意兼容网关)
- **db**:`path` 本地 SQLite;`remote` 把 db 文件回存到任一已配存储,服务重启自动拉取(单实例写)
- 所有密钥支持 `env:VAR_NAME` 间接引用,避免明文

文本(markdown/txt)按标题分块索引;图片/音频/视频整对象直嵌多模态嵌入(无 OCR 依赖)。

## 部署(Cloud Run)

```bash
gcloud run deploy ragoss \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated \        # 或配 OIDC/自定义鉴权
  --set-env-vars RAGOSS_CONFIG=/secrets/config.json \
  --set-secrets ...                # API key 走 Secret Manager(env: 引用)
```

- 索引即服务:`POST /index`。定时索引用 Cloud Scheduler 定时调该端点(cron 每 6 小时一次即可):
  ```bash
  gcloud scheduler jobs create http ragoss-index \
    --schedule "0 */6 * * *" --uri "https://<service-url>/index" \
    --http-method POST --message-body '{}' --oauth-service-account-email <sa>
  ```
- 单实例部署(`--concurrency 1 --max-instances 1`)避免 SQLite 并发写;db 每次索引后回存对象存储,重启自动恢复。

## 评测(rerank 触发基线)

```bash
cp eval/golden.example.json eval/golden.json   # 填入 ≥30 条 {query, expected[]} 
pnpm eval                                     # 输出 hit@1/3/10
```

未来是否接入 rerank 的客观判据:hit@k 持续不达标且错误主要来自"相关但非答案的片段挤占 top-k"。届时在 `src/search/rerank/` 实现真实 provider(候选:jina-reranker-m0 API、Qwen3-VL-Reranker-2B 自部署、或复用问答模型 listwise),接口已就绪。

## 规模上限(ponytail 备注)

暴力扫描在 ~10⁴ 对象内毫秒~百毫秒级;到 10⁵ 级 chunk 或检索延迟不可接受时,把 `src/db.ts` 的向量存储换 Qdrant(接口已隔离在 scanVectors/upsertVector)。索引 API 调用为顺序执行,个人库足够,万级以上再并行化。
