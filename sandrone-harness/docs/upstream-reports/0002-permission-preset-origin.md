# 报告 2

> 投递方式：GitHub Discussions。以下整块可直接粘贴（标题单独填）。
> 发之前请先读 `README.md` 里「关于优先级的一个提醒」：这一条可能被上游按预发布兼容策略判定为不回补。

---

## 标题

```
V0→V1 迁移拒绝 0.1.1-rc.1 写出的 permission/preset 事件，旧会话无法打开
```

## 正文

0.1.1-rc.1 写入的 `permission/preset` 事件带 `origin` 字段，V0→V1 迁移会以「unexpected member」直接失败。

<details>
<summary>复现、预期与验收</summary>

### 复现步骤

1. 用 `@deepseek-ai/dsh@0.1.1-rc.1` 正常使用一段时间（任一会话里切换过权限预设，或让默认预设
   被推断写入即可）。
2. 换到当前版本（`0.2.0-rc.2`，或任何带 V0→V1 迁移的版本）打开该会话。
3. 或直接对一份含该事件的会话跑迁移：

   ```jsonl
   {"type":"permission/preset","seq":12,"time":1755400000000,"data":{"preset":"standard","origin":"inferred"}}
   ```

### 实际结果

迁移抛出 `SessionFormatError`，会话无法打开：

```
permission/preset 12 data has unexpected member "origin"
```

### 预期结果

该事件被正常迁移。`origin` 是**已发布版本**写出的持久字段，V0→V1 迁移的职责就是把它承载过来。

### 证据：`origin` 确实由已发布版本写入

`@deepseek-ai/dsh-permission-presets@0.1.1-rc.1`（npm 已发布）的**类型声明**即为其持久契约，
`lib/types/index.d.ts:35-38`：

```ts
'permission/preset': {
    preset: string;
    origin?: 'default' | 'selection' | 'inferred';
};
```

同文件 `:27-33` 的说明：*"Records the selected preset and whether it came from the session default, an
explicit selection, or legacy-knob inference. … `origin` is optional so logs written before origin tracking
remain readable but are never mistaken for refreshable defaults."*

写入点与取值（同一版本 `lib/index.js`）：

| 行 | 代码 | 写入的 `origin` |
|---|---|---|
| `:312-315` | `session.append("permission/preset", { preset: name, origin })` | 由 `apply()` 的第 4 个参数决定 |
| `:335-338` | `session.append("permission/preset", { preset: name, origin: "default" })` | `"default"` |
| `:349-352` | `session.append("permission/preset", { preset: effective, origin: "inferred" })` | `"inferred"` |
| `:187-189`、`:305-307` | `this.apply(session, name, cb, "selection")` | `"selection"` |
| `:236` | `if (selected?.data.origin !== "default") return;` | 读回该字段做判断 |

三个取值都有实际写入路径。字段在 `0.1.5-rc.1` 被移除（写入点变为 `{ preset: name }`），
`0.2.0-rc.2` 同样只写 `preset`——即 `origin` 是 0.1.1-rc.1 时代的历史数据。

### 根因

`@deepseek-ai/dsh-session-format-v0-to-v1@0.2.0-rc.2`，`lib/index.js:119`：

```js
"permission/preset": disposition(["preset"]),
```

该表的自述（同文件 `:112-118`）是 *"Frozen released-v0 event and payload-member inventory. Every listed
member is preserved by the identity edge."* —— 它声称覆盖「已发布 v0」的成员集合，但对
`permission/preset` 漏掉了 `origin`。

`assertReleasedV0Keys`（`:257-263`）对 `disposition.required + disposition.optional` 之外的任何成员
直接抛错：

```js
function assertReleasedV0Keys(record, required, optional = [], label) {
	const allowed = new Set([...required, ...optional]);
	const unexpected = Object.keys(record).find((key) => !allowed.has(key));
	if (unexpected !== void 0) throw new SessionFormatError(`${label} has unexpected member ${JSON.stringify(unexpected)}`);
	…
}
```

同一份不完整的词表还**重复出现在第二个包**里：
`@deepseek-ai/dsh-session-persistence-jsonl@0.2.0-rc.2` 的 `lib/worker.cjs:6751` 有完全相同的
`"permission/preset": disposition(["preset"]),`。修复需要同时覆盖两处，否则一条路径通过、另一条仍失败。

### 建议修复

承认 `origin` 为可选成员，并按已发布类型限制取值：

```diff
-	"permission/preset": disposition(["preset"]),
+	"permission/preset": disposition(["preset"], ["origin"]),
```

并在该事件的载荷语义校验里，把已发布的三值写在白名单内（未知取值仍然报错）：

```diff
 			nonEmptyString(data["preset"], `${label} preset`);
+			if (data["origin"] !== void 0) literalValue(data["origin"], ["default", "selection", "inferred"], `${label} origin`);
```

这只放行已发布类型声明过的取值；不在白名单内的 `origin` 依旧拒绝，因此没有放宽到「接受任意未知字段」。

### 环境

- 触发版本：`@deepseek-ai/dsh@0.1.1-rc.1`（会话写入方）
- 校验版本：`@deepseek-ai/dsh-session-format-v0-to-v1@0.2.0-rc.2`、`dsh-session-persistence-jsonl@0.2.0-rc.2`
- 平台：Windows x64
- 影响范围：从 0.1.1-rc.1 时代升级上来的用户，其含 `permission/preset` 的会话

### 验收条件

1. 含 `{"preset": "standard", "origin": "default" | "selection" | "inferred"}` 的 V0 事件迁移成功。
2. `origin` 为其他值（例如 `"bogus"`）时仍然拒绝。
3. 不含 `origin` 的事件行为不变。
4. 原始 JSONL 文件字节不变（迁移只读原文件）。
5. `dsh-session-format-v0-to-v1` 与 `dsh-session-persistence-jsonl` 两条路径行为一致。

### 补充：这不是兼容垫片请求

上游 `AGENTS.md` 的 *Pre-release stance* 明确优先正确的地基而非兼容垫片，我理解并尊重这个立场。
但这里请求的不是为**未发布**数据开洞：`origin` 出现在已发布版本的**类型声明**里，是 durable event
payload 的一部分；而 V0→V1 迁移本身就是为承载历史数据而存在的机制。当前状态下，迁移宣称支持
「已发布 v0」却对其中一个已发布成员硬失败——不一致在内核里，而不在请求里。

如果团队更倾向于「旧数据不保证迁移」，也完全可以接受；那么把它写进迁移的文档/错误信息里会更清楚
（例如在拒绝时提示该事件由 0.1.1-rc.1 写入、需先在旧版本导出），比让用户看到
`unexpected member "origin"` 更容易自我诊断。

</details>

---

<!-- 下面这段不要粘贴，是给维护者自己的备注 -->

**为什么值得发**：因果链完整——已发布版本的**类型声明**+**写入点**+**读回点**三处互相印证，
不是「我观察到某些会话有问题」这类弱证据。缺陷在迁移词表与已发布契约不一致，而不是在兼容策略上。

**下游现状**：Sandrone 用 `patches/@deepseek-ai__dsh-session-format-v0-to-v1@0.1.5-rc.1.patch`
打了同一处修复。该分发方在本地审计中迁移过 36 份真实旧会话，其中含 descriptor v2 的子代理。
若上游接受，这个补丁可整体删除。

**如果被判定为不回补**：把该补丁在 `docs/upstream-lock.json` 旁边标注为「长期补丁（上游明确不回补）」，
不要再把它算进「等上游修」的清单里，也不要再为它投入时间。

**发帖前**：在 Discussions 搜 `permission/preset`、`origin`、`migration`、`unexpected member` 确认没有重复帖。
