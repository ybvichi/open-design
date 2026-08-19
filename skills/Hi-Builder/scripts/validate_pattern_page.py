#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from compile_pattern_page import (
    PatternPageError,
    hui_fallback_context,
    load_pattern,
    validate_spec,
)
from core import ContractError, load_json, load_product_context
from renderer_registry import renderer_for_pattern_kind
from semantic_registry import validate_semantic_html
from validate_page import PageParser, validate_runtime_contract


def extract_frozen_json(source: str, name: str) -> dict[str, Any] | None:
    match = re.search(
        rf"const\s+{re.escape(name)}\s*=\s*Object\.freeze\((\{{.*?\}})\);",
        source,
        flags=re.DOTALL,
    )
    if not match:
        return None
    try:
        value = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def validate_pattern_html(
    spec: dict[str, Any], html_path: Path
) -> list[str]:
    validate_spec(spec)
    try:
        context = load_product_context(spec["industry"], spec["product"])
        matched_product = True
    except ContractError as exc:
        context = hui_fallback_context(spec, str(exc))
        matched_product = False
    source = html_path.read_text(encoding="utf-8")
    parser = PageParser()
    parser.feed(source)
    errors = validate_runtime_contract(
        source, parser, context["manifest"], html_path
    )
    errors.extend(validate_semantic_html(source))
    page_config = extract_frozen_json(source, "PAGE_CONFIG")
    preview_fixtures = extract_frozen_json(source, "PREVIEW_FIXTURES")
    if page_config is None:
        errors.append("HTML缺少可解析的PAGE_CONFIG")
    elif "preview" in page_config:
        errors.append("PAGE_CONFIG不得包含Pattern PageSpec的preview模拟数据")
    if preview_fixtures is None:
        errors.append("HTML缺少可解析的PREVIEW_FIXTURES")
    elif preview_fixtures != spec.get("preview"):
        errors.append("PREVIEW_FIXTURES必须原样来自Pattern PageSpec.preview")
    composition = spec.get("knowledge_composition")
    if composition and page_config is not None:
        resolution = page_config.get("composition_resolution", {})
        if resolution.get("status") != "verified":
            errors.append("组合页面缺少已验证的composition_resolution")
        if resolution.get("contribution") != composition.get("expected_contribution"):
            errors.append("组合页面运行配置未记录AI声明的辅助能力")
        if len(page_config.get("pattern_ids", [])) != 2:
            errors.append("组合页面必须记录一个主Variant和一个辅助Variant")
        if composition.get("expected_contribution") == "summary.metrics":
            if 'data-zone="summary.metrics"' not in source or "<h-stats" not in source:
                errors.append("统计辅助Variant未生成summary.metrics区域")
    for marker, message in (
        (
            "Object.prototype.hasOwnProperty.call(vm.$data, key)",
            "loadPreviewFixtures必须只写入data()已声明的同名状态",
        ),
        (
            "key !== 'config'",
            "loadPreviewFixtures必须禁止覆盖config",
        ),
        (
            "cloneRuntimeValue(PREVIEW_FIXTURES)",
            "loadPreviewFixtures必须深复制PREVIEW_FIXTURES",
        ),
    ):
        if marker not in source:
            errors.append(message)
    renderer = renderer_for_pattern_kind(spec["page_kind"])
    if f'"renderer": "{renderer}"' not in source:
        errors.append(f"HTML缺少已登记Renderer标识: {renderer}")
    brand = context["profile"]["brand"]
    if "data-d2c-product-brand" not in source:
        errors.append("HTML缺少产品品牌Logo标识")
    if f'"product_logo": "{brand["logo"]}"' not in source:
        errors.append("HTML未使用产品Profile登记的Logo资源")
    if "portal-logo-mark" in source:
        errors.append("HTML不得使用通用占位Logo替代产品Logo")
    uses_product_shell = '"product_shell_source": "product:' in source
    if uses_product_shell:
        for shell_marker in (
            "portal-pill", "portal-side-collapse", "portal-side-submenu"
        ):
            if shell_marker not in source:
                errors.append(f"HTML缺少产品Portal Shell结构: {shell_marker}")
        for icon_class in (
            "h-icon-menu_leftbar", "h-icon-qrcode", "h-icon-share"
        ):
            if icon_class not in source:
                errors.append(f"HTML缺少产品Portal Shell图标: {icon_class}")
        if "text-decoration: none !important;" not in source:
            errors.append("产品侧栏菜单必须清除HUI文本按钮的悬浮下划线")
    else:
        if "hui-tpp-shell product-context" not in source:
            errors.append("未提供产品专属Shell时必须使用HUI默认Portal Shell")
        if '"product_shell_source": "HUI"' not in source:
            errors.append("使用HUI默认Portal Shell时必须登记Shell来源")
        leaf_menu_with_manual_icon = re.search(
            r"<el-nav-item\b[^>]*>(?:(?!</el-nav-item>).)*<i\b[^>]*\bitem\.icon\b",
            source,
            flags=re.DOTALL,
        )
        if leaf_menu_with_manual_icon:
            errors.append(
                "HUI叶子菜单不得手工渲染图标；一级分组图标必须通过el-subnav的icon API输出"
            )
    if spec.get("filters"):
        if ".query-filter__form .el-form-item { margin-bottom: 0; }" not in source:
            errors.append("query.filter必须清除表单项底部间距，避免与容器内边距叠加")
    pattern = load_pattern(spec["pattern_contract"])
    if pattern.get("family") == "hui.tpp.family.table-manual-filter":
        parameters = pattern.get("parameters", {})
        placement = parameters.get("filter_placement")
        collapse_mode = parameters.get("collapse_mode")
        filters = spec.get("filters", [])
        filter_kinds = {item.get("kind") for item in filters}
        if placement == "regular-box":
            unsupported = filter_kinds - {"input", "select", "date", "date-range", "time"}
            if unsupported:
                errors.append(f"常规过滤不得使用水平Tab变量类型: {sorted(unsupported)}")
            if collapse_mode == "high-low-frequency" and len(filters) <= 4:
                errors.append("常规高低频过滤必须提供超过4个条件以验证换行和展开收起")
            if collapse_mode == "all-retractable" and len(filters) != 4:
                errors.append("全量可收起常规过滤盒必须匹配证据中的4项单行控件")
            if "query-filter--regular" not in source or "query-filter--boxed" not in source:
                errors.append("表格Renderer缺少常规过滤与过滤盒的独立结构")
            if "this.config.filters.slice(0, 3)" not in source:
                errors.append("常规过滤收起态必须保留3个条件，并由查询/重置占据第4列")
            if "grid-template-columns: repeat(4, minmax(0, 1fr))" not in source:
                errors.append("常规过滤必须使用包含查询操作位的四列栅格")
            if ".query-filter__actions { display: flex; grid-column: 4;" not in source:
                errors.append("常规过滤查询/重置必须固定在最后一行第4列")
        elif placement == "horizontal-bar":
            if "checkable-tags" not in filter_kinds:
                errors.append("水平栏过滤必须使用checkable-tags表达Tab选项")
            if "radio" in filter_kinds:
                errors.append("水平栏过滤不得使用radio变量冒充Tab选项")
            if "date-range" not in filter_kinds:
                errors.append("水平栏过滤必须包含证据登记的日期范围控件")
            if "manual-horizontal-filter__tabs" not in source or "el-checkable-tag" not in source:
                errors.append("表格Renderer缺少水平栏Tab选项过滤结构")
            if collapse_mode == "all-retractable" and "manual-horizontal-filter--boxed" not in source:
                errors.append("全量可收起水平栏必须使用带背景过滤容器")
        elif placement == "left-sidebar":
            unsupported = filter_kinds - {"input", "select"}
            if unsupported:
                errors.append(f"侧边栏过滤只允许输入与选择控件: {sorted(unsupported)}")
            if "manual-filter-sidebar" not in source:
                errors.append("表格Renderer缺少独立左侧手动过滤栏")
    if pattern.get("family") == "hui.tpp.family.form-anchored":
        anchor_rules = {
            "margin-right: calc(-1 * var(--d2c-page-form-content-inline-padding))": "表单滚动条必须延伸到form-area__content最右侧",
            "margin-top: calc(-1 * var(--d2c-page-form-content-padding-top))": "表单滚动条顶部不得受content内边距约束",
            "position: relative; z-index: 1": "表单滚动层必须位于锚点面板下方",
            "position: absolute": "锚点面板必须使用绝对定位且不占表单横向空间",
            "right: 12px": "锚点面板必须位于表单右侧",
            "box-shadow: 0 2px 12px rgba(0, 0, 0, .12)": "锚点面板必须带阴影",
        }
        for marker, message in anchor_rules.items():
            if marker not in source:
                errors.append(message)
        form_end = source.find("</el-form>", source.find('ref="permissionForm"'))
        scroll_end = source.find("</div>", form_end)
        anchor_start = source.find('class="form-anchor-nav"')
        if form_end == -1 or scroll_end == -1 or anchor_start < scroll_end:
            errors.append("锚点面板必须位于表单滚动容器之外，避免占用或跟随内容滚动")
        if "margin-bottom: calc(-1 * var(--d2c-page-form-content-padding-bottom))" in source:
            errors.append("表单滚动条不得越过固定操作栏")
    if pattern.get("family") == "hui.tpp.family.table-details-pane":
        for marker in (
            'class="collection-main"', 'class="table-detail-pane"',
            'data-zone="detail.content"',
            'data-component="detail.details-pane"',
            "@row-click=\"selectDetailRow\"",
        ):
            if marker not in source:
                errors.append(f"详情栏表格页缺少选择联动结构: {marker}")
        if "--d2c-page-table-details-width: 431px" not in source:
            errors.append("详情栏表格页未使用Variant合同登记的详情栏宽度")
        separators = pattern.get("parameters", {}).get("separators", {})
        filter_separator = separators.get("filter_toolbar", {})
        if (
            filter_separator.get("owner") != ".query-filter::after"
            or filter_separator.get("mechanism") != "pseudo-element"
            or filter_separator.get("token") != "--h-color-border-tertiary"
        ):
            errors.append("详情栏Variant未正确登记筛选栏底部分割线")
        if ".query-filter::after" not in source:
            errors.append("详情栏表格页未渲染筛选栏底部分割线")
        master_separator = separators.get("master_details", {})
        if master_separator.get("token") != "--h-color-border-tertiary":
            errors.append("详情栏Variant未登记主列表与详情栏的边框token")
        if "table-detail-pane.has-master-divider::before" not in source:
            errors.append("详情栏表格页未渲染主列表与详情栏分隔线")
        expected_spacing = {
            "content_end_padding": "24px",
            "pane_width": "455px",
            "pane_padding": "8px 0px 40px 24px",
            "tabs_content_padding": "8px 0px",
            "container_margin": "0px -20px",
            "item_padding": "0px 0px 0px 20px",
            "item_margin": "0px 0px 24px",
            "title_height": "22px",
        }
        if pattern.get("parameters", {}).get("details_spacing") != expected_spacing:
            errors.append("详情栏Variant内部间距未完整继承典型页采集证据")
        for variable in (
            "--d2c-page-table-details-content-end-padding: 24px",
            "--d2c-page-table-details-pane-width: 455px",
            "--d2c-page-table-details-pane-padding: 8px 0px 40px 24px",
            "--d2c-page-table-details-tabs-content-padding: 8px 0px",
            "--d2c-page-table-details-container-margin: 0px -20px",
            "--d2c-page-table-details-item-padding: 0px 0px 0px 20px",
            "--d2c-page-table-details-item-margin: 0px 0px 24px",
            "--d2c-page-table-details-title-height: 22px",
        ):
            if variable not in source:
                errors.append(f"详情栏Renderer未消费典型页间距变量: {variable}")
        if "table-detail-pane__summary" in source:
            errors.append("详情栏不得插入典型页知识未登记的额外摘要卡")
        if "margin: 0; padding: var(--d2c-page-table-details-pane-padding" not in source:
            errors.append("详情栏必须使用内部padding，不得用外部margin模拟典型页间距")
    if pattern.get("family") == "hui.tpp.family.table-realtime-filter":
        if pattern.get("parameters", {}).get("filter_container_padding_vertical") != "16px":
            errors.append("即时过滤Variant必须登记过滤容器上下16px内间距")
        if pattern.get("parameters", {}).get("filter_option_interactive_tone") != "brand":
            errors.append("即时过滤Variant必须登记过滤选项悬浮与选中态使用品牌色")
        if pattern.get("parameters", {}).get("selected_filter_state_separator") != "dashed-top":
            errors.append("即时过滤Variant必须登记已选条件区顶部虚线分割规则")
        if pattern.get("parameters", {}).get("selected_filter_state_spacing_before") != "24px":
            errors.append("即时过滤Variant必须登记已选条件区与筛选条件的24px间距")
        if pattern.get("parameters", {}).get("selected_filter_state_padding_vertical") != "16px":
            errors.append("即时过滤Variant必须登记已选条件区上下16px内间距")
        if pattern.get("parameters", {}).get("selected_filter_state_bottom_spacing_compensation") != "-16px":
            errors.append("即时过滤Variant必须抵消父子容器叠加的底部16px间距")
        if pattern.get("parameters", {}).get("selected_filter_state_visibility_when_empty") != "hidden":
            errors.append("即时过滤Variant必须登记无已选条件时隐藏已选条件区")
        if pattern.get("parameters", {}).get("selected_filter_clear_action_placement") != "after-selected-items":
            errors.append("即时过滤Variant必须登记清空操作紧跟已选条件项")
        if pattern.get("parameters", {}).get("selected_filter_clear_action_tone") != "brand":
            errors.append("即时过滤Variant必须登记清空操作使用品牌色")
        if pattern.get("parameters", {}).get("selected_filter_clear_action_interactive_tone") != "brand-stable":
            errors.append("即时过滤Variant必须保持清空操作交互态品牌色稳定")
        if 'v-if="selectedRealtimeFilters.length" class="realtime-filter__selected"' not in source:
            errors.append("即时过滤已选条件区在无条件时未隐藏")
        if ".realtime-filter__selected .el-button { margin-left: 0; }" not in source:
            errors.append("即时过滤清空操作未紧跟已选条件项")
        if ".realtime-filter__selected .realtime-filter__clear { color: var(--h-color-brand) !important; }" not in source:
            errors.append("即时过滤清空操作未使用主题品牌色")
        if ".realtime-filter__selected .realtime-filter__clear:active { color: var(--h-color-brand) !important; }" not in source:
            errors.append("即时过滤清空操作交互态未保持主题品牌色")
        if ".realtime-filter { flex: none; margin: 0 24px; padding: 16px 0; border-bottom: 1px solid var(--h-color-border-tertiary); }" not in source:
            errors.append("即时过滤容器未使用上下16px内间距")
        if ".realtime-filter__options .el-tag.is-checkable:not(.is-checked):hover { color: var(--h-color-brand); border-color: var(--h-color-brand); }" not in source:
            errors.append("即时过滤选项悬浮态未使用主题品牌色")
        if ".realtime-filter__options .el-tag.is-checkable.is-checked:hover { color: #fff; border-color: var(--h-color-brand); background-color: var(--h-color-brand) !important; }" not in source:
            errors.append("即时过滤选项选中态未使用主题品牌色")
        if ".realtime-filter__selected { gap: 8px; margin-top: 24px; margin-bottom: -16px; padding: 16px 0; border-top: 1px dashed var(--h-color-border-tertiary); }" not in source:
            errors.append("即时过滤已选条件区缺少顶部虚线分割线")
    if spec["page_kind"] == "table":
        for renderer_variable in (
            "--d2c-renderer-table-content-margin: 0px 12px",
            "--d2c-renderer-table-content-padding: 0px 12px",
            "--d2c-renderer-page-actions-margin: 0px",
            "--d2c-renderer-page-actions-padding: 0px 24px",
            "--d2c-renderer-page-actions-border: none",
        ):
            if renderer_variable not in source:
                errors.append(f"表格Renderer未应用公共布局规则: {renderer_variable}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="验证HUI TPP Pattern Page HTML")
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--html", required=True, type=Path)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    try:
        spec = load_json(args.spec.resolve())
        errors = validate_pattern_html(spec, args.html.resolve())
    except (PatternPageError, ContractError, OSError) as exc:
        errors = [str(exc)]
    report = {
        "passed": not errors,
        "html": str(args.html),
        "spec": str(args.spec),
        "errors": errors,
    }
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    if errors:
        print(f"[FAIL] {args.html}")
        for error in errors:
            print(f"  - {error}")
        return 1
    print(f"[PASS] {args.html}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
