# ragoss 开发计划(v1,无重排模型)

## Context

个人多模态知识库(仿阿里云 OSS 数据索引思路自建):markdown + 图片为核心语料,视频/音频少量;数据分散在多平台对象存储(含 WebDAV);模块化服务化部署。Council 结论(2026-08-28,3 advisor 收敛):

- **v1 不加 rerank**;检索 = 双路多模态嵌入召回 → RRF 融合 → 元数据过滤 → top-k 送问答模型
- **预留可插拔多模态 rerank provider 接口**(输入 query + 图文候选),v1 默认 no-op
- rerank 触发条件(满足后再接):评测显示小 k 检索噪声主导错误 / 语料 10⁴–10⁵⁺ / 事实型查询为主;届时选型 jina-m0 API → Qwen3-VL-Reranker-2B → QA 模型 listwise

## 已定决策

| # | 决策 | 结论 |
|---|------|------|
| D1 | 技术栈 | **TypeScript(strict)+ Hono**,单包 monorepo 无需,模块化目录 |
| D2 | 部署 | 主部署 **Cloud Run**(Docker);Workers 兼容仅作设计约束(不引 Node-only 依赖到 core 路径之外;v1 不双发) |
| D3 | 向量存储 | **SQLite 自管**(向量列 + 暴力扫描,预留 sqlite-vec 升级位);db 文件回存对象存储,启动拉取,单实例写。10⁵ 级再换 Qdrant(接口隔离在 search/ 内) |
| D4 | 语料 | markdown + 图片核心;音视频少量(音频嵌入走支持音频的 provider) |
| D5/D6 | 嵌入接入 | **全 config 驱动**:provider 协议类型 + baseUrl + apiKey + modelId 用户自配 |
| D7 | 问答接入 | **多协议 QA provider**:支持 `openai`(Chat Completions)、`openai-responses`(Responses API)、`google`(Gemini generateContent)、`anthropic`(Messages)四种格式;支持**多模态输入**(图进上下文);baseUrl/apiKey/modelId 自配 |
| D8 | 存储 | provider 注册制:S3 兼容(`@aws-sdk/client-s3` 自定义 endpoint,覆盖 OSS/COS/R2/B2/MinIO)+ WebDAV(`webdav` 包) |
| — | 排除项 | Cloudflare Vectorize 等内置向量化/检索;OCR/caption 管线(多模态嵌入直嵌图片);向量数据库;队列/Redis |

## Approach

```
src/
  core/      类型与 provider 接口:ObjectRecord / Chunk / RetrievalHit / EmbeddingProvider /
             StorageProvider / QaProvider / RerankProvider(多模态契约)+ provider 注册表
  storage/   s3.ts(S3 兼容)、webdav.ts;统一 list_objects/fetch/metadata(size/mime/mtime/etag/路径)
  embedding/ 内部统一输入 {text?, image?, audio?, video?} → 向量
             dashscope.ts、google.ts;两路并行,config 指定各路端点/模型
  index/     增量管线:变更检测(etag+mtime 快照表)→ md 按标题分块 / 媒体整对象 → 双路嵌入 → SQLite 写入
             → db 回传对象存储
  search/    双路 top-k → RRF(自实现 ~10 行)→ 元数据过滤(mime/存储/路径/时间)→ rerank hook(no-op)
  qa/        统一内部消息格式(content parts: text/image)→ 4 个协议 adapter 序列化发送;
             组装检索上下文 + 来源引用(对象 URL/路径)
  server/    Hono 路由:POST /index(全量/增量)、POST /search、POST /ask、GET /health;
             手动触发 + 定时(Cloud Scheduler 或 cron 调 /index)
  deploy/    Dockerfile(multi-stage, distroless)→ Cloud Run;索引复用同一镜像
config.example.json  storages[] / embeddings[2] / qa{protocol,baseUrl,apiKey,modelId} / retrieval{topK,…}
```

关键简化:无 OCR/caption;无向量 DB;RRF 自实现;rerank = 接口 + no-op;SQLite 单文件即全部索引状态。

## Files to create

```
ragoss/
  package.json  tsconfig.json(strict)  Dockerfile  .env.example
  src/core/{types,registry}.ts
  src/storage/{s3,webdav}.ts
  src/embedding/{dashscope,google}.ts
  src/index/{pipeline,chunker,detect}.ts
  src/search/{retrieve,rrf}.ts + src/search/rerank/noop.ts
  src/qa/{provider,index}.ts + src/qa/adapters/{openai,openai-responses,google,anthropic}.ts
  src/server/app.ts
  config.example.json
  eval/hit_at_k.ts(golden 评测脚本)
```

## Steps

- [ ] S0 骨架:TS strict + Hono + config 加载/校验 + provider 注册表 + git init
- [ ] S1 storage:S3 兼容 + WebDAV provider,list/fetch/元数据统一
- [ ] S2 embedding:dashscope + google provider(文本与图片直嵌;音频按 provider 能力)
- [ ] S3 SQLite schema(chunks/vectors/snapshots)+ 增量索引管线 + db 对象存储回传/启动拉取
- [ ] S4 检索:双路召回 + RRF + 元数据过滤 + rerank no-op 钩子
- [ ] S5 qa:内部消息格式 + 4 协议 adapter(openai/openai-responses/google/anthropic)+ /ask 引用来源
- [ ] S6 server 路由汇总 + Dockerfile + Cloud Run 部署 + 定时索引
- [ ] S7 golden 评测脚本(hit@k,先 ≥30 条)+ README 冒烟文档

## Verification

- S1:真实 WebDAV 与任一 S3 兼容端点列举/抓取成功
- S3:索引二次运行零新增写入(幂等);db 断电重启后从对象存储恢复
- S4:自然语言查询已知 markdown/图片命中 top-k;注入假 reranker 证明钩子生效
- S5:至少 openai 与 anthropic 两协议真实/录制请求冒烟;多模态消息(带图)正确序列化;回答含正确来源
- S6:Cloud Run URL 全链路 /ask 通;/health 探活;定时索引触发一次成功
- S7:hit@k 输出数值基线,作为 rerank 未来触发的度量

## 后续(非 v1)

Workers 双发;音视频深度支持(关键帧抽取);rerank 真实现(jina-m0/Qwen3-VL-Reranker);Qdrant 迁移;评测集扩到 50–100 条
