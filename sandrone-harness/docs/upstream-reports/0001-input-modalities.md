# 报告 1（优先发）

> 投递方式：GitHub Discussions。以下整块可直接粘贴（标题单独填）。

---

## 标题

```
目录覆盖省略 inputModalities 时模型会静默退化为纯文本
```

## 正文

覆盖内置模型目录时省略 `inputModalities`，该模型会静默丢失图片能力。

<details>
<summary>复现、预期与验收</summary>

### 复现步骤

1. 在 `llm-deepseek` 的 `config.models` 里定义一个与内置模型**同 id** 的条目，只改 `name`（或
   `contextWindow`），**省略 `inputModalities`**：

   ```yaml
   - id: llm-deepseek
     config:
       models:
         - id: deepseek-flash
           name: 我的 Flash
           contextWindow: 128000
           # inputModalities 有意省略：期望沿用内置 deepseek-flash 的能力
   ```

2. 在该会话里发送一张图片。

### 实际结果

- 该模型被解析为 `inputModalities: ["text"]`，图片能力丢失。
- 走 Messages 适配器时直接抛错：
  `DeepSeek Messages image input requires a vision model and attachment service`（`UNSUPPORTED_CONTENT`）。
- 走 Chat 适配器时更隐蔽：核心 LLM 运行时会把图片替换成文本占位符，用户看到的是「模型看不见图」，
  而不是一个明确的错误。`@deepseek-ai/dsh-llm@0.2.0-rc.2` 的 `lib/index.js:729-742`
  （`replaceImagesForTextModel`，注释即 *"Replace every image occurrence for a text-only model."*）
  把每个图片块换成 `textOnlyImageText()` 的返回值（`:558-560`）：

  ```
  [image omitted because this model accepts text only; attachment sha256:xxxxxxxx]
  ```

  也就是说模态一旦判错，模型会收到一条「本模型只接受文本」的说明，而用户完全不知道原因。
- 图片计费也一并按纯文本走（见下方 :274）。

### 预期结果

省略 `inputModalities` 时，沿用与该 id 匹配的内置模型能力。`DEFAULT_MODELS` 里
`deepseek-flash` 明确声明了 `inputModalities: ["text", "image"]`，这份数据已经存在，只是没有被用上。

### 根因

`@deepseek-ai/dsh-llm-deepseek@0.2.0-rc.2`，`lib/index.js`：

| 行 | 代码 | 说明 |
|---|---|---|
| `:303` | `inputModalities: z.array(z.union(MODEL_MODALITIES)).min(1).default(["text"])` | `catalogModel` 的 schema 默认值 |
| `:349` | `const inputModalities = model.inputModalities ?? ["text"];` | `resolveModels` 的回退 |
| `:494` | `inputModalities: model.inputModalities ?? ["text"]` | `catalogModelInfo` 的第二处回退 |
| `:274` | `if (catalogModel?.inputModalities?.includes("image") !== true) return { priceImages: … textOnlyPrice }` | 计费也跟着错 |
| `:1415` | `if (model?.inputModalities?.includes("image") !== true \|\| attachments === void 0) throw new LlmError(…)` | Messages 路径的门禁 |
| `:42-54` | `DEFAULT_MODELS`：`deepseek-flash` → `inputModalities: ["text","image"]` | 本可用于回退的数据 |

关键点：**zod 的 `.default(["text"])` 在 parse 阶段就把省略物化成了 `["text"]`**，因此 `:349` 与 `:494`
的 `?? ["text"]` 永远观察不到 `undefined`——这两处回退是死代码。所以只改 `??` 不足以修复，必须同时
让 schema 保留「省略」这个状态。

`@deepseek-ai/dsh-llm-pi-ai@0.2.0-rc.2` 有同构的问题：`:940` `const DEFAULT_INPUT = ["text"]`、
`:1027` `defaultInput: z.array(z.union(MODALITIES)).default([...DEFAULT_INPUT])`、
`:1103` `const defaultInput = [...source.defaultInput ?? DEFAULT_INPUT]`。

### 建议修复

两步，缺一不可：

```diff
@@ catalogModel schema
-	inputModalities: z.array(z.union(MODEL_MODALITIES)).min(1).default(["text"]),
+	inputModalities: z.array(z.union(MODEL_MODALITIES)).min(1).default(void 0),
```

```diff
@@ resolveModels
-	const inputModalities = model.inputModalities ?? ["text"];
+	const inputModalities = model.inputModalities ?? DEFAULT_MODELS.find((entry) => entry.id === model.id)?.inputModalities ?? ["text"];
```

（`:494` 的 `catalogModelInfo` 同理，或让它复用 `resolveModels` 的结果，避免同一判断出现两处。）

显式声明 `inputModalities` 时仍然优先，未知 id 仍然回落到 `["text"]`，因此这是纯增益，不改变既有
显式配置的行为。

### 环境

- `@deepseek-ai/dsh-llm-deepseek` `0.2.0-rc.2`（已核对 npm 已发布的最新版本；`0.1.5-rc.1` 同样存在）
- 平台：Windows x64
- 触发方式：`llm-deepseek` 的 `config.models` 覆盖内置 id

### 验收条件

1. 同 id、只改 `name`/`contextWindow`、省略 `inputModalities` 的目录条目，其生效模态等于内置模型的模态。
2. 显式写 `inputModalities` 时以显式值为准（含显式 `["text"]` 降级）。
3. 未知 id 省略时仍为 `["text"]`。
4. 同一份生效模态同时驱动请求准备、图片计费（`:274`）与适配器序列化，三者不得分歧。

### 补充

这不是分发方的偏好改动。一旦模态判断偏了，用户拿到的是一个**静默的错误结果**而不是可诊断的失败：
`dsh-llm` 的 `replaceImagesForTextModel`（`:729-742`）会把图片换成
`[image omitted because this model accepts text only; …]`，计费也跟着走文本档。省略即继承内置能力，
也符合 `AGENTS.md` 里「显式优于隐式」在包边界的另一种读法：默认值应当是显式的 `resolve` 结果，
而不是 schema 里一个看不见的字面量。

</details>

---

<!-- 下面这段不要粘贴，是给维护者自己的备注 -->

**为什么值得发**：这是「省略字段」被 schema 静默改写成另一个值，属于可证明的行为缺陷，且不涉及
上游的预发布兼容策略。修复是纯增益。

**下游现状**：Sandrone 用 `patches/@deepseek-ai__dsh-llm-deepseek@0.1.5-rc.1.patch` 打了同一处修复
（另有 3 个同族补丁处理相关联的门禁）。上游接受后，这一个补丁可以整体删除。

**发帖前**：在 Discussions 搜 `inputModalities`、`image`、`vision`、`catalog` 确认没有重复帖。
