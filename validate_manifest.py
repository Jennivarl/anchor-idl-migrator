import json, yaml
with open('codemod.yaml') as f:
    codemod = yaml.safe_load(f)
with open('workflow.yaml') as f:
    workflow = yaml.safe_load(f)
# Show workflow node names and step names
for node in workflow.get('nodes', []):
    print(f"Node: {repr(node.get('name', ''))}")
    for step in node.get('steps', []):
        print(f"  Step: {repr(step.get('name', ''))}")
        jsg = step.get('js-ast-grep', {})
        print(f"    language: {repr(jsg.get('language', ''))}")
        print(f"    js_file: {repr(jsg.get('js_file', ''))}")
# Serialize to JSON (as server would)
manifest = {**codemod, 'workflow': workflow}
s = json.dumps(manifest, ensure_ascii=True)
print(f"\nManifest JSON length: {len(s)}")
print("JSON parse test:", "OK" if json.loads(s) else "FAIL")
