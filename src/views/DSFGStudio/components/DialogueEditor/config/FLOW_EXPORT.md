# 流程出口导出

普通 Group 与条件分支节点都会生成一个 ActionGroup，并共用 `groupOrder` 中的全局编号。
从开始节点出发，按节点出口从上到下的顺序遍历；条件节点可以作为编号 0。
ActionGroup 表仍按每 100 项拆成一个字典项，NextGroup 保存的是全局编号，不是块内编号。

条件节点生成一个在 0 秒触发的 ActionClip：

| 字段 | 值 |
| --- | --- |
| actionType | `NOLOC_BRANCH` |
| duration | `0.00` |
| stringParams | `outputs.map(output => output.condition)`，保留空字符串和原文 |
| intParams | 空列表 |
| ActionGroup.NextGroup | 每个出口所连接节点的全局序号，未连接则为 `-1` |

NextGroup 的槽位规则对条件分支、选项卡及普通对话出口一致：

- 一出口一槽位，按界面从上到下的顺序；不能过滤空位或合并重复目标。
- 第 1、3 个出口连接到全局编号 4、8，第 2 个出口空着，导出为 `[4, -1, 8]`。
- 多个出口连接到同一节点时保留重复序号，例如 `[4, 4, -1]`。
- 单个未连接的对话出口导出为 `[-1]`；零出口节点导出为 `[]` 并给出无出口警告。
- 陈旧连线指向已不存在/不可导出的节点时，该槽位同样为 `-1`。
- NextGroup 与表达式都是普通列表，因此单节点最多导出 100 个出口；超出时明确报错，不截断。

条件只作为字符串保存和导出，编辑器不会解析或执行表达式。运行时标识定义在
`qxqyActionRegistry.ts` 的 `CONDITION_BRANCH_ACTION_TYPE` 中。
