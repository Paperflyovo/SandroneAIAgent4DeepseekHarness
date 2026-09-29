# 上游反馈报告

这里存放准备发给 DeepSeek Harness 上游的缺陷报告。每份都是一份可直接粘贴的帖子，格式对齐上游
`.github/ISSUE_TEMPLATE/bug.md`（中文标题 + 一句话结论 + `<details>` 复现块）。

## 反馈通道的实际情况（2026-09-29 核实）

| 通道 | 状态 |
|---|---|
| GitHub Issues | **关闭**（`api.github.com/repos/deepseek-ai/deepseek-harness` → `has_issues: false`） |
| Pull Request | **不接受**。上游 `CONTRIBUTING.md`：*"We are sorry that we cannot accept external pull requests at the moment."* |
| GitHub Discussions | **开启**（`has_discussions: true`），且是 `CONTRIBUTING.md` 指定的缺陷反馈渠道 |

`CONTRIBUTING.md` 对 Discussions 的原话是：*"Identify and report issues or bugs in GitHub Discussions …
Upvote discussions that you would like to bring to the team's attention. We are a very small team and may
not be able to reply to every post, but we monitor them and consider them when allocating resources."*

所以现在的投递方式是：在 Discussions 里发帖。上面的 `ISSUE_TEMPLATE` 仍然值得照抄，因为上游的
issue 模板、issue-management 配置与 PR 模板是一套统一规范；如果 Issues 以后重新开放，这两份稿子
可以直接当作 issue 提交，不需要改写。

## 投递前的三件事

1. **先搜一下有没有重复**。上游团队明确说人少、看不过来，重复帖会稀释权重。
2. **一帖一事**。两份稿子分开发，不要合并。
3. **把 `<details>` 里的「环境」按自己的实际情况填**，尤其是触发版本。

## 一件比报告更重要的事

上游 `CONTRIBUTING.md` 第 19 段值得单独读一遍：

> DeepSeek Harness is designed to be deeply customizable. We do not believe that packages in the official
> repository are inherently more important than packages created by the community. You may consider this
> repository an idea, an official showcase, and a source of inspiration, but **not a mandate from us**.
> We have already seen exciting projects emerge from the community, and we hope to see the ecosystem
> continue to grow in its own directions.

也就是说：上游**明确把社区包视为同级**，并且主动鼓励插件生态（给项目打 `dsh-plugin` topic 就能被
别人发现）。Sandrone 不是「抄官方」，而是这套设计预期的产物。

## 关于优先级的一个提醒

上游 `AGENTS.md` 顶部有一节 *"Pre-release stance: foundation over blast radius"*，写明在没有外部消费者
的阶段**优先正确的地基而不是兼容垫片**，并明确说后端会拒绝旧磁盘格式。这意味着：

- **报告 1（图片能力）** 属于能力缺陷，与兼容性策略无关，大概率是被接受的方向。
- **报告 2（旧会话迁移）** 属于历史数据兼容。它仍然是一个真缺陷——`origin` 是**已发布版本**写出来的，
  不是未发布的数据——但上游有明确立场可能选择不回补。发之前心里要有这个数：被拒不是你的错，也不代表
  报告写得不好。

结论：**优先发报告 1**。报告 2 发出后如果被判定为「不回补」，就把那条补丁在 `docs/upstream-lock.json`
旁边标注为长期补丁，不要再指望上游。
