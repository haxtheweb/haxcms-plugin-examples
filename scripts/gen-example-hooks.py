#!/usr/bin/env python3
# Regenerates the hook sections of examples/example (plugin.yaml, Node, PHP) from schema/hook-contracts.json.
# Custom bodies below are kept; every other hook gets a logging stub with the contract's comment.
import json, re, os
root = os.path.join(os.path.dirname(__file__), "..")
C = json.load(open(os.path.join(root, "schema/hook-contracts.json")))
import yaml
C = C + yaml.safe_load(open(os.path.join(root, "examples/example/config/hooks.yaml")))  # the example's own hooks
ex = os.path.join(root, "examples/example")
extras = {
  **{f"entity.{p}.{o}": "    entities: [awesomeFile]\n" for p in ("before","after") for o in ("create","read","update","delete")},
  "config.before.read": '    config: ["*"]\n', "config.after.read": '    config: ["*"]\n', "config.after.save": '    config: ["*"]\n',
  "git.after.commit": "    detached: true\n",
}
node_body = {
  "entity.before.create": '      if (ctx.subject && ctx.subject.name === "boring.awesome") return ctx.veto("Too boring. Add more explosions.");\n      log("entity.before.create", ctx);\n',
  "plugin.before.requirements": '      log("plugin.before.requirements", ctx);\n      const unmet = [...ctx.subject];\n      if (!ctx.settings.greeting) unmet.push({ key: "settings.greeting", message: "Set a greeting before this plugin activates" });\n      return unmet;\n',
  "config.before.save": '      log("config.before.save", ctx);\n      return ctx.subject;\n',
  "register.before.prompts": '      log("register.before.prompts", ctx);\n      return ctx.subject;\n',
  "git.after.commit": '      // detached: runs after the response is sent. A real plugin would spawn the declared command (exec: [rsync]) here.\n      log("git.after.commit", ctx);\n',
}
php_body = {
  "entity.before.create": '    if (isset($ctx->subject["name"]) && $ctx->subject["name"] === "boring.awesome") {\n      return $ctx->veto("Too boring. Add more explosions.");\n    }\n    $this->log("entity.before.create", $ctx);\n',
  "plugin.before.requirements": '    $this->log("plugin.before.requirements", $ctx);\n    $unmet = $ctx->subject;\n    if (empty($ctx->settings["greeting"])) {\n      $unmet[] = ["key" => "settings.greeting", "message" => "Set a greeting before this plugin activates"];\n    }\n    return $unmet;\n',
  "config.before.save": '    $this->log("config.before.save", $ctx);\n    return $ctx->subject;\n',
  "register.before.prompts": '    $this->log("register.before.prompts", $ctx);\n    return $ctx->subject;\n',
  "git.after.commit": '    // detached: runs after the response is sent. A real plugin would spawn the declared command (exec: [rsync]) here.\n    $this->log("git.after.commit", $ctx);\n',
}
def camel(n):
  parts = n.split("."); return parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:])
# plugin.yaml
p = os.path.join(ex, "plugin.yaml"); s = open(p).read()
start = s.index("hooks:\n"); rest = s[start + 7:]
m = re.search(r"^[a-zA-Z]", rest, re.M); tail = rest[m.start():] if m else ""
block = "hooks:\n" + "".join(f"  - name: {c['name']}\n" + extras.get(c["name"], "") for c in C)
open(p, "w").write(s[:start] + block + tail)
# node
p = os.path.join(ex, "src/nodejs/index.js"); s = open(p).read()
head = s[: s.index("  hooks: {\n") + len("  hooks: {\n")]
body = "".join(f"    // {c['comment']}\n    \"{c['name']}\": async (ctx) => {{\n" + node_body.get(c["name"], f"      log(\"{c['name']}\", ctx);\n") + "    },\n" for c in C)
open(p, "w").write(head + body + "  },\n};\n")
# php
p = os.path.join(ex, "src/php/Plugin.php"); s = open(p).read()
# keep everything before the first hook block (class header, helpers, scheduled job handlers)
head = s[: s.rfind("\n\n", 0, s.index("  // hook: ")) + 1]
body = "".join(f"\n  // {c['comment']}\n  // hook: {c['name']}\n  public function {camel(c['name'])}($ctx) {{\n" + php_body.get(c["name"], f"    $this->log(\"{c['name']}\", $ctx);\n") + "  }\n" for c in C)
open(p, "w").write(head + body + "}\n")
print(f"{len(C)} hooks written")
