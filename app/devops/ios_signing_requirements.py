"""Generate iOS distribution requirements from declared app and extension targets."""

# Only signing declarations are authoritative: ApplicationId/CodesignEntitlements
# in the app project and resolved Release settings in every extension Xcode project.
# Profile input names are compatibility inputs, never a list of required capabilities.

import argparse
import ast
import base64
from collections import UserDict
from dataclasses import dataclass
from datetime import timezone
import html
import json
import os
from pathlib import Path
import re
import sys
import tempfile

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException

from verify_ios_signing import (
    PLUTIL, XCODEBUILD, SigningError, decode_profile, read_plist, run,
    validate_entitlements, validate_profile,
)


BACKGROUND_ASSETS_POINT = "com.apple.background-asset-downloader-extension"
VARIABLE = re.compile(r"\$\(([^()]+)\)|\$\{([^{}]+)\}")


@dataclass
class SigningTarget:
    name: str
    bundle_id: str
    entitlements: dict
    kind: str
    extension_point: str | None = None


class MsbuildProperties(UserDict):
    """Match MSBuild's case-insensitive property names."""

    def __getitem__(self, key):
        """Read a property without regard to its spelling's case."""
        return self.data[key.casefold()]

    def __setitem__(self, key, value):
        """Store a property under its canonical lowercase name."""
        self.data[key.casefold()] = value

    def __contains__(self, key):
        """Check for a property using MSBuild's case-insensitive names."""
        return key.casefold() in self.data


def expand(value, properties, allow_empty=False):
    if isinstance(value, dict):
        return {key: expand(item, properties, allow_empty) for key, item in value.items()}
    if isinstance(value, list):
        return [expand(item, properties, allow_empty) for item in value]
    if not isinstance(value, str):
        return value

    def replace(match):
        name = match[1] or match[2]
        if name not in properties and not allow_empty:
            raise SigningError(f"Unresolved signing build setting: {name}")
        return str(properties.get(name, ""))

    for _ in range(20):
        result = VARIABLE.sub(replace, value)
        if result == value:
            if "$(" in result or "${" in result:
                raise SigningError("Unresolved or cyclic signing build settings")
            return result
        value = result
    raise SigningError("Cyclic signing build settings")


def _condition_value(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (str, bool)):
        return node.value.casefold() if isinstance(node.value, str) else node.value
    if isinstance(node, ast.Name) and node.id.casefold() in {"true", "false"}:
        return node.id.casefold() == "true"
    if isinstance(node, ast.BoolOp):
        values = [_condition_value(value) for value in node.values]
        return all(values) if isinstance(node.op, ast.And) else any(values)
    if isinstance(node, ast.Compare) and len(node.ops) == 1:
        left, right = _condition_value(node.left), _condition_value(node.comparators[0])
        if isinstance(node.ops[0], ast.Eq):
            return left == right
        if isinstance(node.ops[0], ast.NotEq):
            return left != right
    raise SigningError("Unsupported condition on an iOS signing declaration")


def _target_platform(match, properties):
    framework = expand(match[1], properties)
    parsed = re.fullmatch(r"net[\d.]+(?:-([a-z]+)[\d.]*)?", framework, flags=re.IGNORECASE)
    if parsed is None:
        raise SigningError(f"Unsupported target framework in signing condition: {framework}")
    return repr((parsed[1] or "").casefold())


def _host_platform(match, properties):
    platform = expand(match[1], properties).casefold()
    if platform not in {"osx", "macos", "windows", "linux", "freebsd"}:
        raise SigningError(f"Unsupported host platform in signing condition: {platform}")
    return str(platform in {"osx", "macos"})


def ios_condition(condition, properties):
    if not condition:
        return True
    condition = re.sub(
        r"\$\(\[MSBuild\]::GetTargetPlatformIdentifier\('([^']*)'\)\)",
        lambda match: _target_platform(match, properties), condition, flags=re.IGNORECASE,
    )
    condition = re.sub(
        r"\$\(\[MSBuild\]::IsOSPlatform\('([^']+)'\)\)",
        lambda match: _host_platform(match, properties), condition,
        flags=re.IGNORECASE,
    )
    condition = expand(condition, properties)
    condition = re.sub(r"\bAND\b", "and", condition, flags=re.IGNORECASE)
    condition = re.sub(r"\bOR\b", "or", condition, flags=re.IGNORECASE)
    try:
        result = _condition_value(ast.parse(condition, mode="eval").body)
    except (SyntaxError, ValueError) as error:
        raise SigningError("Cannot evaluate a condition on an iOS signing declaration") from error
    if isinstance(result, str):
        if result not in {"true", "false"}:
            raise SigningError("A signing declaration condition did not produce a boolean")
        return result == "true"
    return result


def _bundle_id(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*", value):
        raise SigningError(f"{label}: missing or unresolved explicit bundle identifier")
    return value


def _read_build_document(path):
    try:
        return ElementTree.parse(path, forbid_dtd=True, forbid_entities=True, forbid_external=True).getroot()
    except (OSError, ElementTree.ParseError, DefusedXmlException) as error:
        raise SigningError(f"Cannot read app signing declarations: {path}") from error


def _tag(element):
    return element.tag.split("}")[-1]


def _signing_documents(project):
    inherited = {}
    for name in ["Directory.Build.props", "Directory.Build.targets"]:
        for directory in [project.parent, *project.parent.parents]:
            path = directory / name
            if path.is_file():
                inherited[name] = path
                break
    paths = [inherited.get("Directory.Build.props"), project, inherited.get("Directory.Build.targets")]
    documents = [(path, _read_build_document(path)) for path in paths if path is not None]
    for path, tree in documents:
        if any(_tag(element) in {"Import", "ImportGroup", "UsingTask"} for element in tree.iter()):
            raise SigningError(f"Unsupported explicit MSBuild import or task declaration in signing inputs: {path}")
    return documents


def _variables(value):
    if isinstance(value, dict):
        return set().union(*(_variables(item) for item in value.values()))
    if isinstance(value, list):
        return set().union(*(_variables(item) for item in value))
    if not isinstance(value, str):
        return set()
    return {(match[1] or match[2]).casefold() for match in VARIABLE.finditer(value)}


def _property_records(element, conditions=()):
    condition = element.get("Condition")
    conditions = conditions + ((condition,) if condition else ())
    if _tag(element) == "PropertyGroup":
        return [(_tag(child).casefold(), child, conditions + ((child.get("Condition"),) if child.get("Condition") else ()))
                for child in element]
    return [record for child in element for record in _property_records(child, conditions)]


def _required_properties(documents, additional):
    records = [record for _, tree in documents for record in _property_records(tree)]
    required = {"applicationid", "codesignentitlements", *additional}
    while True:
        previous = set(required)
        for name, element, conditions in records:
            if name in required:
                required.update(_variables(element.text))
                required.update(_variables(list(conditions)))
        if required == previous:
            return required, {name for name, _, _ in records}


def _relevant(element, required):
    return any(name in required for name, _, _ in _property_records(element))


def _apply_group(group, properties, required, fixed):
    if not _relevant(group, required) or not ios_condition(group.get("Condition"), properties):
        return
    for element in group:
        name = _tag(element).casefold()
        if name not in required or name in fixed:
            continue
        if list(element):
            raise SigningError(f"Unsupported nested signing property: {_tag(element)}")
        if ios_condition(element.get("Condition"), properties):
            properties[name] = expand((element.text or "").strip(), properties)


def _file_properties(properties, path):
    properties["MSBuildThisFileDirectory"] = str(path.parent) + os.sep
    properties["MSBuildThisFileFullPath"] = str(path)
    properties["MSBuildThisFileName"] = path.stem


def _apply_document(path, tree, properties, required, fixed):
    _file_properties(properties, path)
    targets = []
    if not ios_condition(tree.get("Condition"), properties):
        return targets
    for element in tree:
        if _tag(element) == "PropertyGroup":
            _apply_group(element, properties, required, fixed)
        elif _tag(element) == "Target" and _relevant(element, required):
            targets.append((path, element))
        elif _relevant(element, required):
            raise SigningError(f"Unsupported {_tag(element)} containing signing properties in {path}")
    return targets


def _apply_signing_target(path, target, properties, required, fixed):
    _file_properties(properties, path)
    if not ios_condition(target.get("Condition"), properties):
        return
    if (target.get("BeforeTargets") != "_DetectSigningIdentity"
            or any(target.get(key) for key in ["AfterTargets", "DependsOnTargets", "Inputs", "Outputs"])):
        raise SigningError("Signing-property targets must run directly before _DetectSigningIdentity")
    if any(_tag(child) not in {"PropertyGroup", "Message", "Warning", "Error"} for child in target):
        raise SigningError("Tasks in signing-property targets require native MSBuild evaluation")
    for group in target:
        if _tag(group) == "PropertyGroup":
            _apply_group(group, properties, required, fixed)


def _evaluate_properties(project, documents, framework, additional=()):
    required, declared = _required_properties(documents, additional)
    properties = MsbuildProperties({name: "" for name in required & declared})
    context = {"TargetFramework": framework, "Configuration": "Release", "RuntimeIdentifier": "ios-arm64",
               "_SdkIsSimulator": "false", "EnableCodeSigning": "true",
               "MSBuildProjectDirectory": str(project.parent), "ProjectDir": str(project.parent) + os.sep}
    properties.update(context)
    properties.setdefault("ApplicationId", "")
    properties.setdefault("CodesignEntitlements", "")
    fixed = {key.casefold() for key in context}
    targets = []
    for path, tree in documents:
        for element in tree.iter():
            output = element.get("PropertyName") if _tag(element) == "Output" else None
            if output and output.casefold() in required:
                raise SigningError(f"Task-produced signing property cannot be resolved statically: {output}")
        targets.extend(_apply_document(path, tree, properties, required, fixed))
    if len(targets) > 1:
        raise SigningError("Multiple signing-property targets require native MSBuild evaluation")
    for path, target in targets:
        _apply_signing_target(path, target, properties, required, fixed)
    return properties


def app_requirement(project):
    project = Path(project).resolve()
    documents = _signing_documents(project)
    tree = next(tree for path, tree in documents if path == project)
    frameworks = {
        framework.strip() for element in tree.iter()
        if element.tag.split("}")[-1] in {"TargetFramework", "TargetFrameworks"}
        for framework in (element.text or "").split(";")
        if re.fullmatch(r"net[\d.]+-ios[\d.]*", framework.strip())
    }
    if len(frameworks) != 1:
        raise SigningError(f"{project.name}: expected one explicitly declared iOS target framework")
    framework = frameworks.pop()
    properties = _evaluate_properties(project, documents, framework)
    bundle_id = _bundle_id(properties.get("ApplicationId"), project.stem)
    properties["CFBundleIdentifier"] = bundle_id
    path = properties.get("CodesignEntitlements")
    entitlements = read_plist(project.parent / path.replace("\\", "/")) if path else {}
    properties = _evaluate_properties(project, documents, framework, _variables(entitlements))
    properties["CFBundleIdentifier"] = bundle_id
    entitlements = expand(entitlements, properties)
    return SigningTarget(project.stem, bundle_id, entitlements, "app")


def _extension_requirement(target, settings, project):
    platforms = settings.get("SUPPORTED_PLATFORMS", "").split()
    sdk = settings.get("SDKROOT", "").casefold()
    if platforms and "iphoneos" not in platforms:
        return None
    if not platforms and "iphoneos" not in sdk:
        if sdk:
            return None
        raise SigningError(f"{target}: Xcode did not identify its supported platforms")
    bundle_id = _bundle_id(expand(settings.get("PRODUCT_BUNDLE_IDENTIFIER"), settings), target)
    entitlement_path = expand(settings.get("CODE_SIGN_ENTITLEMENTS", ""), settings)
    entitlements = expand(read_plist(project.parent / entitlement_path), settings) if entitlement_path else {}
    info_path = expand(settings.get("INFOPLIST_FILE", ""), settings)
    info = expand(read_plist(project.parent / info_path), settings) if info_path else {}
    attributes = info.get("EXAppExtensionAttributes", {})
    extension_point = attributes.get("EXExtensionPointIdentifier") if isinstance(attributes, dict) else None
    classic = info.get("NSExtension", {})
    if not extension_point and isinstance(classic, dict):
        extension_point = classic.get("NSExtensionPointIdentifier")
    return SigningTarget(target, bundle_id, entitlements, "extension", extension_point)


def _release_requirement(records, target, project):
    matches, observed = [], []
    for record in records:
        settings = record.get("buildSettings", {})
        canonical = settings.get("TARGET_NAME") or record.get("target")
        if canonical == target:
            matches.append(settings)
        # Build settings may contain the runner's environment. Report only these
        # two public target identifiers, never the complete native command output.
        observed.append({key: value[:160] if isinstance(value, str) else None for key, value in [
            ("target", record.get("target")), ("TARGET_NAME", settings.get("TARGET_NAME"))]})
    ios = [(settings, _extension_requirement(target, settings, project)) for settings in matches]
    ios = [(settings, requirement) for settings, requirement in ios if requirement is not None]
    device = [(settings, requirement) for settings, requirement in ios
              if settings.get("PLATFORM_NAME") == "iphoneos" or "iphoneos" in settings.get("SDKROOT", "").casefold()]
    preferred = device or ios
    if not matches or (preferred and any(requirement != preferred[0][1] for _, requirement in preferred[1:])):
        raise SigningError(f"{project.name}: missing or ambiguous Release settings for {target}; "
                           f"matches={len(matches)}, records={len(records)}, ios={len(ios)}, device={len(device)}, "
                           f"observed identifiers={json.dumps(observed[:20], ensure_ascii=True)}")
    return preferred[0][1] if preferred else None


def extension_requirements(directory, runner=run):
    targets = []
    directory = Path(directory).resolve()
    if not directory.is_dir():
        raise SigningError(f"Missing extension project directory: {directory}")
    for project in sorted(directory.rglob("*.xcodeproj")):
        try:
            parsed = json.loads(runner([PLUTIL, "-convert", "json", "-o", "-", str(project / "project.pbxproj")]))
            names = [item["name"] for item in parsed["objects"].values()
                     if item.get("isa") == "PBXNativeTarget" and item.get("productType", "").endswith("extension")]
            if not names:
                continue
            resolved = json.loads(runner([XCODEBUILD, "-project", str(project), "-alltargets",
                                          "-configuration", "Release", "-showBuildSettings", "-json",
                                          "CODE_SIGNING_ALLOWED=NO"]))
        except (KeyError, TypeError, AttributeError, json.JSONDecodeError) as error:
            raise SigningError(f"Cannot discover extension signing declarations: {project}") from error
        for name in names:
            requirement = _release_requirement(resolved, name, project)
            if requirement:
                targets.append(requirement)
    return targets


def discover_requirements(app_project, extensions_dir, runner=run):
    targets = [app_requirement(app_project), *extension_requirements(extensions_dir, runner)]
    bundle_ids = [target.bundle_id for target in targets]
    if len(set(bundle_ids)) != len(bundle_ids):
        raise SigningError("Declared iOS targets have duplicate bundle identifiers")
    if any(not target.bundle_id.startswith(targets[0].bundle_id + ".") for target in targets[1:]):
        raise SigningError("Declared iOS extension bundle identifiers must extend the app bundle identifier")
    return targets


def requirement_dict(target):
    return {"target": target.name, "bundle_id": target.bundle_id, "kind": target.kind,
            "extension_point": target.extension_point, "entitlements": target.entitlements}


def _write_profile(directory, name, encoded):
    try:
        decoded = base64.b64decode("".join(encoded.split()), validate=True)
    except (ValueError, TypeError, AttributeError) as error:
        raise SigningError(f"Invalid base64 provisioning profile in {name}") from error
    if not decoded:
        raise SigningError(f"Empty provisioning profile in {name}")
    with tempfile.NamedTemporaryFile(dir=directory, prefix=".profile-", delete=False) as stream:
        stream.write(decoded)
        stream.flush()
        temporary = Path(stream.name)
    try:
        temporary.chmod(0o600)
        temporary.replace(directory / name)
    finally:
        temporary.unlink(missing_ok=True)


def import_profile_inputs(directory, environment):
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    for variable, filename in [("IOS_PROVISIONING_PROFILE_BASE64", "legacy-app.mobileprovision"),
                               ("IOS_EXTENSION_PROVISIONING_PROFILE_BASE64", "legacy-extension.mobileprovision")]:
        encoded = environment.get(variable)
        if encoded:
            _write_profile(directory, filename, encoded)
    collection = environment.get("IOS_PROVISIONING_PROFILES_BASE64")
    if collection:
        try:
            values = json.loads(collection)
        except json.JSONDecodeError as error:
            raise SigningError("IOS_PROVISIONING_PROFILES_BASE64 must be a JSON list or object") from error
        if isinstance(values, dict):
            values = list(values.values())
        if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
            raise SigningError("IOS_PROVISIONING_PROFILES_BASE64 must contain only base64 profile strings")
        for index, encoded in enumerate(values):
            _write_profile(directory, f"collection-{index:04d}.mobileprovision", encoded)
    return directory


def _profile_matches(profile, bundle_id):
    prefixes = profile.get("ApplicationIdentifierPrefix", profile.get("TeamIdentifier", []))
    entitlements = profile.get("Entitlements", {})
    return isinstance(prefixes, list) and isinstance(entitlements, dict) and entitlements.get("application-identifier") in {
        f"{prefix}.{bundle_id}" for prefix in prefixes if isinstance(prefix, str)}


def _candidate(target, path, profile):
    errors = []
    label = f"{target.name} ({target.bundle_id})"
    try:
        team = validate_profile(profile, target.bundle_id, label)
    except SigningError as error:
        errors.append(str(error))
        team = None
    for key, requested in target.entitlements.items():
        try:
            validate_entitlements({key: requested}, profile, label)
        except SigningError:
            errors.append(f"{label}: profile {path.name} does not authorize {key}={json.dumps(requested, ensure_ascii=False)}")
    if errors:
        return None, errors
    return (path, profile, team), []


def match_profiles(targets, directory, runner=run):
    profiles = [(path, decode_profile(path, runner)) for path in sorted(Path(directory).glob("*.mobileprovision"))]
    choices, failures = {}, []
    for target in targets:
        matches = [(path, profile) for path, profile in profiles if _profile_matches(profile, target.bundle_id)]
        if not matches:
            failures.append(f"{target.name} ({target.bundle_id}): missing App Store distribution profile; "
                            f"requested entitlements: {json.dumps(target.entitlements, ensure_ascii=False, sort_keys=True)}")
            continue
        valid, invalid = [], []
        for path, profile in matches:
            candidate, errors = _candidate(target, path, profile)
            if candidate:
                valid.append(candidate)
            invalid.extend(errors)
        if not valid:
            failures.extend(invalid)
        choices[target.bundle_id] = valid
    if failures:
        raise SigningError("iOS provisioning requirements are not satisfied:\n" + "\n".join(failures))
    teams = set.intersection(*(set(item[2] for item in choices[target.bundle_id]) for target in targets))
    if len(teams) != 1:
        raise SigningError("Declared iOS targets must have compatible profiles from one unambiguous signing team")
    team = teams.pop()
    selected = {}
    for bundle_id, candidates in choices.items():
        valid = [item for item in candidates if item[2] == team]
        selected[bundle_id] = max(valid, key=lambda item: item[1]["ExpirationDate"].replace(tzinfo=timezone.utc))[0]
    return selected


def export_profiles(targets, profiles, path):
    values = {"IOS_SIGNING_PROFILES_JSON": json.dumps({key: str(value) for key, value in profiles.items()}, sort_keys=True)}
    for target in targets:
        if target.kind == "app":
            values["IOS_APP_PROFILE"] = str(profiles[target.bundle_id])
        if target.extension_point == BACKGROUND_ASSETS_POINT:
            if "ASSET_PACK_DOWNLOADER_PROFILE" in values:
                raise SigningError("Multiple Background Assets targets cannot share the legacy packaging profile variable")
            values["ASSET_PACK_DOWNLOADER_PROFILE"] = str(profiles[target.bundle_id])
    if any("\n" in value or "\r" in value for value in values.values()):
        raise SigningError("Provisioning profile output paths must not contain newlines")
    with Path(path).open("a", encoding="utf8") as stream:
        stream.writelines(f"{key}={value}\n" for key, value in values.items())


def write_summary(targets, path):
    def cell(value):
        return html.escape(str(value), quote=False).replace("|", "&#124;").replace("\n", " ")

    with Path(path).open("a", encoding="utf8") as stream:
        stream.write("### iOS distribution signing requirements\n\n")
        stream.write("Generated from the app and extension Release signing declarations.\n\n")
        stream.write("| Target | Bundle ID | Required entitlements |\n| --- | --- | --- |\n")
        for target in targets:
            capabilities = "<br>".join(
                f"<code>{cell(key)}={cell(json.dumps(value, ensure_ascii=False))}</code>"
                for key, value in sorted(target.entitlements.items())) or "None declared"
            stream.write(f"| {cell(target.name)} | <code>{cell(target.bundle_id)}</code> | {capabilities} |\n")
        stream.write("\n")


def main(argv=None, environment=None, runner=run):
    parser = argparse.ArgumentParser(description=__doc__, epilog=(
        "Optional profile inputs: IOS_PROVISIONING_PROFILE_BASE64 and "
        "IOS_EXTENSION_PROVISIONING_PROFILE_BASE64 each contain one base64 profile. "
        "IOS_PROVISIONING_PROFILES_BASE64 is a JSON list of base64 profiles or an "
        "object mapping bundle IDs to base64 profiles. No other environment inputs are inspected."))
    parser.add_argument("--app-project", type=Path, default=Path("app/BibleOnSite/BibleOnSite.csproj"))
    parser.add_argument("--extensions-dir", type=Path, default=Path("app/extensions"))
    parser.add_argument("--profiles-dir", type=Path, required=True, help="Directory of supplied .mobileprovision files")
    parser.add_argument("--github-env", type=Path, help="Append selected profile paths for packaging")
    parser.add_argument("--github-summary", type=Path, help="Append generated target and capability requirements as Markdown")
    parser.add_argument("--requirements-out", type=Path, help="Write generated target/entitlement requirements as JSON")
    args = parser.parse_args(argv)
    try:
        targets = discover_requirements(args.app_project, args.extensions_dir, runner)
        requirements = [requirement_dict(target) for target in targets]
        print(json.dumps({"ios_signing_requirements": requirements}, ensure_ascii=False, sort_keys=True))
        if args.github_summary:
            write_summary(targets, args.github_summary)
        if args.requirements_out:
            args.requirements_out.write_text(json.dumps(requirements, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
        directory = import_profile_inputs(args.profiles_dir, os.environ if environment is None else environment)
        profiles = match_profiles(targets, directory, runner)
        if args.github_env:
            export_profiles(targets, profiles, args.github_env)
    except SigningError as error:
        print(f"iOS signing verification failed: {error}", file=sys.stderr)
        return 1
    print(f"Validated distribution provisioning for {len(targets)} declared iOS targets")
    return 0


if __name__ == "__main__":
    sys.exit(main())
