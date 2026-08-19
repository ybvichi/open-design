#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from core import (
    ContractError,
    load_json,
    load_product_context,
    validate_json_contract,
)
from renderer_registry import (
    contract_for_renderer,
    renderer_for_pattern_kind,
    template_for_renderer,
)
from semantic_registry import SemanticRegistryError, assert_semantic_html

ROOT = Path(__file__).resolve().parents[1]
HUI_ROOT = ROOT / "design-systems" / "HUI"
PAGE_PATTERN_ROOT = (
    ROOT
    / "design-systems"
    / "HUI"
    / "page-patterns"
    / "tpp"
    / "pages"
)
CARD_RUNTIME_CONTRACT = (
    ROOT
    / "design-systems"
    / "HUI"
    / "runtime-contracts"
    / "others"
    / "card.json"
)
COMPOSITION_REGISTRY = (
    HUI_ROOT / "page-patterns" / "tpp" / "mappings" / "composition.json"
)


class PatternPageError(ValueError):
    pass


def load_pattern(relative: str) -> dict[str, Any]:
    path = (PAGE_PATTERN_ROOT / relative).resolve()
    if PAGE_PATTERN_ROOT.resolve() not in path.parents:
        raise PatternPageError(f"页面模式越界: {relative}")
    contract = load_json(path)
    if contract.get("schema_version") != "hui-page-variant.v1":
        raise PatternPageError(f"页面模式版本无效: {relative}")
    return contract


def resolve_knowledge_composition(
    spec: dict[str, Any], primary: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    composition = spec.get("knowledge_composition")
    if not composition:
        return None
    registry = load_json(COMPOSITION_REGISTRY)
    page_kind = spec["page_kind"]
    if page_kind not in registry.get("supported_page_kinds", []):
        raise PatternPageError(f"当前页面类型不支持TPP知识组合: {page_kind}")
    secondary_path = composition["secondary_pattern_contract"]
    if secondary_path == spec["pattern_contract"]:
        raise PatternPageError("主Variant与辅助Variant不得相同")
    secondary = load_pattern(secondary_path)
    expected_family_prefix = f"hui.tpp.family.{page_kind}-"
    if not primary.get("family", "").startswith(expected_family_prefix):
        raise PatternPageError("主Variant与page_kind不一致")
    if not secondary.get("family", "").startswith(expected_family_prefix):
        raise PatternPageError("辅助Variant必须与主Variant属于相同page_kind")
    primary_parameters = primary.get("parameters", {})
    secondary_parameters = secondary.get("parameters", {})
    for key in registry.get("exclusive_parameter_keys", []):
        if (
            key in primary_parameters
            and key in secondary_parameters
            and primary_parameters[key] != secondary_parameters[key]
        ):
            raise PatternPageError(
                "TPP组合参数冲突: "
                f"{key}={primary_parameters[key]} vs {secondary_parameters[key]}"
            )
    rule = registry.get("secondary_exports", {}).get(secondary_path)
    if not rule:
        raise PatternPageError(f"辅助Variant未登记可组合能力: {secondary_path}")
    renderer = renderer_for_pattern_kind(page_kind)
    if rule.get("page_kind") != page_kind or rule.get("renderer") != renderer:
        raise PatternPageError("辅助Variant与主页面Renderer不兼容")
    expected = composition["expected_contribution"]
    if expected != rule.get("contribution"):
        raise PatternPageError(
            f"辅助能力声明不一致: {expected} != {rule.get('contribution')}"
        )
    missing_spec = [
        key for key in rule.get("required_spec_fields", []) if not spec.get(key)
    ]
    if missing_spec:
        raise PatternPageError(
            f"辅助Variant缺少PageSpec变量: {', '.join(missing_spec)}"
        )
    preview = spec.get("preview", {})
    missing_preview = [
        key for key in rule.get("required_preview_fields", []) if key not in preview
    ]
    if missing_preview:
        raise PatternPageError(
            f"辅助Variant缺少preview变量: {', '.join(missing_preview)}"
        )
    return secondary, rule


def validate_spec(spec: dict[str, Any]) -> list[dict[str, Any]]:
    schema = load_json(ROOT / "schemas" / "pattern-page-spec.schema.json")
    schema_errors = validate_json_contract(spec, schema)
    if schema_errors:
        raise PatternPageError("\n".join(schema_errors))
    if spec.get("schema_version") != "pattern-page-spec.v2":
        raise PatternPageError("schema_version必须是pattern-page-spec.v2")
    page_kind = spec.get("page_kind")
    try:
        renderer_for_pattern_kind(page_kind)
    except ValueError as exc:
        raise PatternPageError(str(exc)) from exc
    for key in (
        "industry", "product", "id", "title", "pattern_contract", "portal"
    ):
        if not spec.get(key):
            raise PatternPageError(f"缺少必要字段: {key}")
    side_menu_ids = set()
    for item in spec["portal"].get("side_menus", []):
        side_menu_ids.add(item.get("id"))
        side_menu_ids.update(
            child.get("id") for child in item.get("children", [])
        )
    if spec["portal"].get("active_side_menu") not in side_menu_ids:
        raise PatternPageError("active_side_menu必须存在于side_menus")
    patterns = [load_pattern(spec["pattern_contract"])]
    if (
        patterns[0].get("family") == "hui.tpp.family.table-details-pane"
        and not spec.get("detail_tabs")
    ):
        raise PatternPageError("详情栏表格页必须声明detail_tabs")
    composition_resolution = resolve_knowledge_composition(spec, patterns[0])
    if composition_resolution:
        patterns.append(composition_resolution[0])
    if page_kind == "details":
        family = patterns[0].get("family", "")
        if not family.startswith("hui.tpp.family.details-"):
            raise PatternPageError(
                "details页面必须引用已验证的HUI详情页Variant合同"
            )
    alternate = spec.get("alternate_pattern_contract")
    if page_kind == "switch":
        if not alternate:
            raise PatternPageError("switch页面必须声明alternate_pattern_contract")
        patterns.append(load_pattern(alternate))
    elif alternate:
        raise PatternPageError("只有switch页面允许alternate_pattern_contract")
    if page_kind == "card-tabs":
        tabs = spec.get("card_tabs")
        if not isinstance(tabs, list) or len(tabs) < 2:
            raise PatternPageError("card-tabs页面至少声明两个card_tabs")
        card_usage = load_json(CARD_RUNTIME_CONTRACT).get("d2c_usage", {})
        profiles = card_usage.get("visual_profiles", {})
        tab_ids = set()
        for tab in tabs:
            for key in ("id", "label", "card_profile", "pattern_contract"):
                if key not in tab:
                    raise PatternPageError(f"card_tabs缺少字段: {key}")
            if tab["id"] in tab_ids:
                raise PatternPageError(f"card_tabs存在重复id: {tab['id']}")
            tab_ids.add(tab["id"])
            if tab["card_profile"] not in profiles:
                raise PatternPageError(
                    f"未知Card视觉Profile: {tab['card_profile']}"
                )
            pattern = load_pattern(tab["pattern_contract"])
            if (
                pattern.get("parameters", {}).get("collection_presentation")
                != tab["card_profile"]
            ):
                raise PatternPageError(
                    f"Card Profile与页面契约不一致: {tab['id']}"
                )
            patterns.append(pattern)
    forbidden = ("px", "color", "font-size", "gap", "width", "height", "align")
    serialized = json.dumps(spec, ensure_ascii=False).lower()
    for word in forbidden:
        if f'"{word}"' in serialized:
            raise PatternPageError(f"Pattern PageSpec不得声明视觉字段: {word}")
    return patterns


def css_variables(values: dict[str, Any], prefix: str = "") -> str:
    lines = []
    for name, value in values.items():
        key = name if name.startswith("--") else f"--d2c-{prefix}{name}"
        lines.append(f"      {key}: {value} !important;")
    return "\n".join(lines)


def pattern_css_variables(pattern: dict[str, Any]) -> str:
    regions = pattern.get("geometry", {}).get("key_regions", {})
    values: dict[str, Any] = {}
    content = regions.get("content", {})
    form = regions.get("form", {})
    footer = regions.get("footer", {})
    content_head = regions.get("content_head", {})
    group_title = regions.get("group_title", {})
    detail_tabs = regions.get("tabs", {})
    if content.get("padding"):
        values["form-content-padding"] = content["padding"]
    if form.get("rect", {}).get("width"):
        values["form-width"] = f'{form["rect"]["width"]}px'
    if footer.get("rect", {}).get("height"):
        values["form-footer-height"] = f'{footer["rect"]["height"]}px'
    if content_head.get("rect", {}).get("height"):
        values["form-content-head-height"] = f'{content_head["rect"]["height"]}px'
    if content_head.get("padding"):
        values["form-content-head-padding"] = content_head["padding"]
    for key in ("margin", "padding", "border"):
        if group_title.get(key):
            values[f"form-group-title-{key}"] = group_title[key]
    if detail_tabs.get("rect", {}).get("width"):
        values["table-details-width"] = f'{detail_tabs["rect"]["width"]}px'
    details_spacing = pattern.get("parameters", {}).get("details_spacing", {})
    for key, value in details_spacing.items():
        values[f"table-details-{key.replace('_', '-')}"] = value
    steps_form_gap = pattern.get("parameters", {}).get("steps_form_gap")
    if steps_form_gap:
        values["form-steps-form-gap"] = steps_form_gap
    for parameter in ("form_item_gap", "title_field_gap", "group_gap"):
        value = pattern.get("parameters", {}).get(parameter)
        if value:
            values[f"form-{parameter.replace('_', '-')}"] = value
    return css_variables(values, "page-")


def renderer_css_variables(renderer: str) -> str:
    return css_variables(
        contract_for_renderer(renderer).get("layout_roles", {}), "renderer-"
    )


def replace_once(source: str, marker: str, value: str) -> str:
    if source.count(marker) != 1:
        raise PatternPageError(f"模板哨兵必须唯一: {marker}")
    return source.replace(marker, value, 1)


INCLUDE_PATTERN = re.compile(r"<!--\s*@include\s+([^\s]+)\s*-->")


def load_template(path: Path, stack: tuple[Path, ...] = ()) -> str:
    path = path.resolve()
    if path in stack:
        chain = " -> ".join(item.as_posix() for item in (*stack, path))
        raise PatternPageError(f"模板include循环引用: {chain}")
    if not path.is_file():
        raise PatternPageError(f"模板不存在: {path}")
    source = path.read_text(encoding="utf-8")

    def expand(match: re.Match[str]) -> str:
        return load_template(path.parent / match.group(1), (*stack, path))

    return INCLUDE_PATTERN.sub(expand, source)


def resolve_renderer_template(renderer: str, product: str, root: Path = ROOT) -> tuple[Path, str]:
    default_path = root / template_for_renderer(renderer)
    renderer_name = default_path.name
    product_path = root / "assets" / "templates" / "products" / product / "renderers" / renderer_name
    if product_path.is_file():
        return product_path, f"product:{product}"
    return default_path, "HUI"


def renderer_styles(renderer: str, product: str) -> str:
    sources = []
    for relative in contract_for_renderer(renderer).get("styles", []):
        hui_path = ROOT / relative
        product_path = (
            ROOT / "assets" / "templates" / "products" / product
            / "styles" / hui_path.name
        )
        sources.append((product_path if product_path.is_file() else hui_path).read_text(encoding="utf-8"))
    return "\n".join(sources)


def product_shell_assets(product: str) -> tuple[str, str, str, str]:
    product_root = ROOT / "assets" / "templates" / "products" / product
    hui_root = ROOT / "assets" / "templates" / "HUI"
    requested = {
        "styles": (product_root / "styles/portal.css", hui_root / "styles/portal.css"),
        "start": (product_root / "shells/portal-start.html", hui_root / "shells/portal-start.html"),
        "end": (product_root / "shells/portal-end.html", hui_root / "shells/portal-end.html"),
    }
    selected = {
        key: product_path if product_path.is_file() else hui_path
        for key, (product_path, hui_path) in requested.items()
    }
    source = f"product:{product}" if all(path == requested[key][0] for key, path in selected.items()) else "HUI"
    return (
        selected["styles"].read_text(encoding="utf-8"),
        load_template(selected["start"]),
        load_template(selected["end"]),
        source,
    )


def hui_fallback_context(spec: dict[str, Any], reason: str) -> dict[str, Any]:
    manifest = load_json(HUI_ROOT / "manifest.json")
    token_contract = load_json(HUI_ROOT / manifest["theme"]["token_contract"])
    return {
        "manifest": manifest,
        "profile": {
            "brand": {
                "name": "HUI 通用管理平台",
                "logo": "../assets/imgs/hui-logo.png",
            }
        },
        "product_tokens": {
            "schema_version": "product-theme-tokens.v1",
            "id": "hui.fallback.theme",
            "extends": token_contract["id"],
            "overrides": {},
        },
        "portal_shell": {
            "geometry_roles": {},
            "breakpoints": {},
            "portal": {"top_menus": [spec["portal"]["active_top_menu"]]},
        },
        "token_contract": token_contract,
        "resolution": {
            "matched": False,
            "level": "hui-fallback",
            "reason": reason,
        },
    }


def compile_pattern_page(spec: dict[str, Any]) -> str:
    patterns = validate_spec(spec)
    try:
        context = load_product_context(spec["industry"], spec["product"])
    except (ContractError, KeyError) as exc:
        context = hui_fallback_context(spec, str(exc))
    manifest = context["manifest"]
    profile = context["profile"]
    product_tokens = context["product_tokens"]
    portal = context["portal_shell"]
    if spec["portal"]["active_top_menu"] not in portal["portal"]["top_menus"]:
        raise PatternPageError("active_top_menu必须存在于产品Portal Shell的top_menus")
    renderer = renderer_for_pattern_kind(spec["page_kind"])
    template_path, renderer_source = resolve_renderer_template(renderer, spec["product"])
    source = load_template(template_path)
    shell_styles, shell_start, shell_end, shell_source = product_shell_assets(spec["product"])
    resources = manifest["resources"]
    source = replace_once(source, "__HUI_CSS__", resources["css"])
    source = replace_once(source, "__VUE_JS__", resources["vue"])
    source = replace_once(source, "__HUI_JS__", resources["hui"])
    source = replace_once(
        source,
        "/* __PRODUCT_TOKENS__ */",
        css_variables(product_tokens["overrides"]),
    )
    source = replace_once(
        source,
        "/* __PORTAL_GEOMETRY__ */",
        css_variables(portal["geometry_roles"]),
    )
    source = replace_once(
        source,
        "/* __PAGE_PATTERN_GEOMETRY__ */",
        "\n".join((
            pattern_css_variables(patterns[0]),
            renderer_css_variables(renderer),
        )),
    )
    source = replace_once(
        source,
        "/* __RENDERER_STYLES__ */",
        renderer_styles(renderer, spec["product"]),
    )
    source = replace_once(source, "/* __PRODUCT_SHELL_STYLES__ */", shell_styles)
    source = replace_once(source, "<!-- __PRODUCT_SHELL_START__ -->", shell_start)
    source = replace_once(source, "<!-- __PRODUCT_SHELL_END__ -->", shell_end)
    runtime_spec = dict(spec)
    preview_fixtures = runtime_spec.pop("preview")
    runtime_spec["renderer"] = renderer
    runtime_spec["renderer_source"] = renderer_source
    runtime_spec["product_shell_source"] = shell_source
    runtime_spec["design_system_resolution"] = context.get("resolution", {"matched": True, "level": "product"})
    runtime_spec["product_name"] = profile["brand"]["name"]
    runtime_spec["product_logo"] = profile["brand"]["logo"]
    runtime_spec["top_menus"] = portal["portal"]["top_menus"]
    runtime_spec["pattern_ids"] = [pattern["id"] for pattern in patterns]
    runtime_spec["pattern_geometry"] = [pattern["geometry"] for pattern in patterns]
    runtime_spec["pattern_family"] = patterns[0]["family"]
    runtime_spec["pattern_parameters"] = patterns[0].get("parameters", {})
    composition_resolution = resolve_knowledge_composition(spec, patterns[0])
    if composition_resolution:
        secondary, rule = composition_resolution
        runtime_spec["composition_resolution"] = {
            "status": "verified",
            "primary_pattern_id": patterns[0]["id"],
            "secondary_pattern_id": secondary["id"],
            "contribution": rule["contribution"],
        }
        runtime_spec["auxiliary_pattern_family"] = secondary["family"]
        runtime_spec["auxiliary_pattern_parameters"] = {
            key: secondary.get("parameters", {}).get(key)
            for key in rule.get("merge_parameter_keys", [])
            if key in secondary.get("parameters", {})
        }
    if spec["page_kind"] == "card-tabs":
        card_usage = load_json(CARD_RUNTIME_CONTRACT)["d2c_usage"]
        enriched_tabs = []
        used_profiles = {}
        for tab, pattern in zip(spec["card_tabs"], patterns[1:]):
            regions = pattern["geometry"]["key_regions"]
            repeat = pattern["geometry"]["repeat_layout"]
            enriched = dict(tab)
            enriched["pattern_id"] = pattern["id"]
            enriched["layout"] = {
                "columns": repeat["columns_in_first_row"],
                "collection_gap": f'{repeat["horizontal_gap"]}px',
                "card_height": f'{regions["card"]["rect"]["height"]}px',
                "header_height": f'{regions["card_header"]["rect"]["height"]}px',
                "body_height": f'{regions["card_body"]["rect"]["height"]}px',
            }
            enriched_tabs.append(enriched)
            used_profiles[tab["card_profile"]] = card_usage["visual_profiles"][
                tab["card_profile"]
            ]
        runtime_spec["card_tabs"] = enriched_tabs
        runtime_spec["card_visual_profiles"] = used_profiles
        runtime_spec["card_tab_style"] = patterns[0]["parameters"]["tab_style"]
    page_config = runtime_spec
    source = replace_once(
        source,
        "/* __PAGE_CONFIG__ */ {}",
        json.dumps(page_config, ensure_ascii=False, indent=10),
    )
    source = replace_once(
        source,
        "/* __PREVIEW_FIXTURES__ */ {}",
        json.dumps(preview_fixtures, ensure_ascii=False, indent=10),
    )
    try:
        assert_semantic_html(source)
    except SemanticRegistryError as exc:
        raise PatternPageError(str(exc)) from exc
    return source


def main() -> int:
    parser = argparse.ArgumentParser(description="编译HUI TPP页面族Pattern PageSpec")
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    try:
        spec = load_json(args.spec.resolve())
        html = compile_pattern_page(spec)
        output = args.out.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(html, encoding="utf-8")
    except (PatternPageError, ContractError, SemanticRegistryError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
