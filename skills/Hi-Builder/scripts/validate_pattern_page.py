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
    if matched_product:
        for shell_marker in (
            "portal-pill", "portal-side-collapse", "portal-side-submenu"
        ):
            if shell_marker not in source:
                errors.append(f"HTML缺少ISC标准Portal Shell结构: {shell_marker}")
        for icon_class in (
            "h-icon-menu_leftbar", "h-icon-qrcode", "h-icon-share"
        ):
            if icon_class not in source:
                errors.append(f"HTML缺少ISC标准Portal Shell图标: {icon_class}")
        if "text-decoration: none !important;" not in source:
            errors.append("ISC侧栏菜单必须清除HUI文本按钮的悬浮下划线")
    else:
        if "hui-tpp-shell product-context" not in source:
            errors.append("未匹配产品时必须使用HUI默认Portal Shell")
        if '"product_shell_source": "HUI"' not in source:
            errors.append("未匹配产品时必须登记HUI Shell来源")
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
        if separators.get("filter_toolbar", {}).get("component") != "el-divider":
            errors.append("详情栏Variant未登记筛选栏与工具栏的HUI分隔组件")
        if '<el-divider v-if="showFilterToolbarDivider" class="collection-filter-divider"></el-divider>' not in source:
            errors.append("详情栏表格页未渲染筛选栏与工具栏分隔线")
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
