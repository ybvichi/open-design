# 知识解析契约

## 解析输入

<!-- rule-owner:resolution-input -->

Resolver只接受语义标识：

- `industry`
- `product`
- `page_type`或标准页面意图
- 用户明确提供的参考资料类型

不得使用颜色、坐标或DOM片段决定知识命中。

## 分层检索顺序

<!-- rule-owner:knowledge-resolution-order -->

按以下顺序解析并记录每层命中来源：

1. 从`design-systems/catalog.json`确定HUI通用知识、行业和产品根目录。
2. 读取HUI manifest的紧凑运行时摘要，不加载全部原子合同。
3. 读取HUI通用Zone和Component Pattern目录。
4. 先读取HUI通用业务语义，再读取行业产品索引及行业扩展；只加载与本次页面意图相关的实体、字段、枚举和动作。
5. 通过产品`product.json`的显式指针加载产品Profile、Shell、tokens和资产清单。
6. 先通过产品页面索引查找精确页面入口；命中时按显式指针读取Capability、payload Schema、Composition、Fixture和Golden。
7. 未命中产品页面时，继续查找已验证HUI页面族及其中央Registry Renderer；仅在目标产品Profile、Shell、tokens均可加载时提供页面族兜底能力。
8. 精确产品页由Composition选择HUI页面模式；HUI兜底页由页面意图选择一个页面族，再由AI依据真实需求选择一个精确Variant。
9. 编译器根据实际使用的HUI标签按需加载原子合同。
10. Validator最后加载完整白名单和golden断言，不把这些内容回灌给AI。

继承方向为：

```text
HUI通用知识 → 行业扩展 → 产品差异 → 页面约束 → 本次PageSpec
```

下层只能在合同允许范围内覆盖上层，不得复制后改名。

## Capability Bundle

<!-- rule-owner:capability-bundle -->

Resolver面向AI输出精简Capability Bundle，而不是原始知识文件集合：

```json
{
  "selection": {
    "industry": "general",
    "product": "isc",
    "page_intent": "event-search",
    "page_pattern": "hui.page-pattern.list-search"
  },
  "allowed_zone_ids": [],
  "allowed_component_pattern_ids": [],
  "business_fields": [],
  "business_actions": [],
  "extension_kinds": [],
  "shell_capabilities": {},
  "runtime_features": []
}
```

Bundle只暴露AI需要做选择的内容。tokens值、HUI完整props、CDN URL、golden坐标和fixture正文不得进入能力摘要。

`resolve_capabilities.py`输出该Bundle。`selection.compile_route`只能是`product-composition`或`hui-pattern-fallback`。HUI兜底还必须输出可选的`pattern_variants`；`can_compile=false`表示产品Composition与可编译HUI兜底均不可用，AI必须报告`knowledge_gaps`。

## AI调用与输入合同选择

<!-- rule-owner:spec-selection -->

AI按以下步骤工作：

1. 从需求识别行业、产品和页面意图；不能确定时报告歧义。
2. 调用Resolver获取能力摘要。
3. 只在能力摘要允许范围内选择业务字段、动作、Zone、Component Pattern和扩展。
4. 生成语义PageSpec，不生成HUI属性、CSS、资源URL或HTML片段。
5. PageSpec Schema不支持用户需求时报告Schema或知识缺口，不用自由字段绕过。

`compile_route=product-composition`时使用`page-spec.v2`，其payload结构只读取当前Capability声明的`spec_schema`。

`compile_route=hui-pattern-fallback`时使用`pattern-page-spec.v2`。该合同必须显式声明`industry`、`product`、`page_kind`和Resolver返回的精确`pattern_contract`；业务字段与内容来自本次真实需求，所有模拟业务值必须显式置于`preview`，产品提供Profile、Shell、tokens和运行资源，HUI Variant提供稳定结构、几何与布局事实。不得用fallback臆造未知业务能力。

两个输入合同的具体字段分别以`schemas/page-spec.schema.json`和`schemas/pattern-page-spec.schema.json`为机器事实源。

## 编译器调用规则

<!-- rule-owner:compiler-resolution -->

Compiler必须重新从事实源加载完整合同，不能信任AI对HUI、资源或tokens的描述：

1. 校验PageSpec。
2. 重放Resolver选择并确认继承关系。
3. 根据`compile_route`和中央Renderer Registry选择实现；产品路由加载Composition，HUI兜底路由加载精确Variant，两者都装配目标产品Shell和tokens。
4. 按需加载HUI原子合同及图标依赖。
5. 按`references/generation-contract.md`应用产品tokens和预览fixture。
6. 输出D2C语义标注及HTML。

## 缺口处理

<!-- rule-owner:knowledge-gap-policy -->

- 未知行业实体或动作：报告行业知识缺口。
- 产品未登记：报告产品知识缺口。
- 页面未登记但已验证HUI页面族可表达：只有该页面族已登记Renderer且产品上下文完整时可走`hui-pattern-fallback`；否则报告Renderer或产品知识缺口。
- HUI组件接口未验证：禁止推测prop或事件。
- 未知Component Pattern或Zone：终止编译。
- 用户要求自由视觉值但Schema不支持：报告覆盖缺口。
