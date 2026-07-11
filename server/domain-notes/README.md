# 领域素材包（可选）

在这个目录放 `tech.md` / `life.md`，服务启动时会自动加载并注入对应房间 AI 的 system prompt；
文件不存在就跳过。单个文件最多注入 2500 字符（超出截断），改文件后需重启服务。

## 怎么生成

赛前用你的 coding agent（有 web search / 可读内部资料）生成后**人工审一遍**再放进来。
可以直接用下面这个提示词：

> 我在准备一个"谁是AI"聊天游戏，AI 要伪装成 Advantest 的测试工程师（93k SmarTest 8 test program
> 或 T2000/non-SoC memory test program 方向）。请生成一份素材清单，markdown 格式：
> 1. 15 条左右这个圈子日常说话会自然带出的行话/黑话（附一句话的典型用法，不要教科书定义）
> 2. 5 个真实感强的 debug 战例（每个 2-3 句话，口语化，带一点不完美的细节，不要精彩的段子）
> 3. 5 条这个岗位的日常吐槽（机台时间、驻场、correlation 之类）
> 要求：内容必须真实可信，宁可少而准，不要编造具体的产品型号数字。

## 格式示例（tech.md）

```markdown
## 行话
- "跑个shmoo看看margin" —— 怀疑 timing/level 临界时的口头禅
- "又bin4了" —— 某个测试项挂了

## 战例
- 有次 FT 良率突然掉，查了两天 pattern，最后是 socket 里一根 pogo pin 歪了
- correlation 对不上，两台机台各说各话，最后发现是 load board 版本不一样

## 吐槽
- 机台时间永远约不到，约到了 handler 又掉料
```

注意：素材会进入 AI 的发言，别放任何涉密/敏感信息。
