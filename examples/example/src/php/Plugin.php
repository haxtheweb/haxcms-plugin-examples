<?php
// Example plugin (PHP). Placeholder until the loader exists: every hook in schema/hooks.json is implemented.
// Each body logs; the comment says what you could do there.
class ExamplePlugin {
  private function log($name, $ctx = null) { error_log("[example] " . $name); }

  // scheduled job declared in plugin.yaml schedules; keep it idempotent and time-bounded
  public function tidy($ctx) {
    $this->log("schedule tidy", $ctx);
  }

  // validate or normalize the new record, or veto with a message
  // hook: entity.before.create
  public function entityBeforeCreate($ctx) {
    if (isset($ctx->subject["name"]) && $ctx->subject["name"] === "boring.awesome") {
      return $ctx->veto("Too boring. Add more explosions.");
    }
    $this->log("entity.before.create", $ctx);
  }

  // react to the new record: notify, index, update a derived store
  // hook: entity.after.create
  public function entityAfterCreate($ctx) {
    $this->log("entity.after.create", $ctx);
  }

  // narrow what is read (for example hide drafts from anonymous callers), or veto
  // hook: entity.before.read
  public function entityBeforeRead($ctx) {
    $this->log("entity.before.read", $ctx);
  }

  // annotate or redact what the caller receives; not detachable because the caller waits for it
  // hook: entity.after.read
  public function entityAfterRead($ctx) {
    $this->log("entity.after.read", $ctx);
  }

  // compare with ctx.previous, normalize, or veto
  // hook: entity.before.update
  public function entityBeforeUpdate($ctx) {
    $this->log("entity.before.update", $ctx);
  }

  // react to what changed between ctx.previous and the subject
  // hook: entity.after.update
  public function entityAfterUpdate($ctx) {
    $this->log("entity.after.update", $ctx);
  }

  // refuse deletion (for example while something depends on it), or veto
  // hook: entity.before.delete
  public function entityBeforeDelete($ctx) {
    $this->log("entity.before.delete", $ctx);
  }

  // clean up anything that pointed at the deleted record
  // hook: entity.after.delete
  public function entityAfterDelete($ctx) {
    $this->log("entity.after.delete", $ctx);
  }

  // inspect or adjust the page before it is written (for example clean up markup), or veto
  // hook: page.before.save
  public function pageBeforeSave($ctx) {
    $this->log("page.before.save", $ctx);
  }

  // react to the saved page: re-index for search, invalidate a cache, notify
  // hook: page.after.save
  public function pageAfterSave($ctx) {
    $this->log("page.after.save", $ctx);
  }

  // refuse to delete a page others link to, or veto
  // hook: page.before.delete
  public function pageBeforeDelete($ctx) {
    $this->log("page.before.delete", $ctx);
  }

  // clean up anything tied to the deleted page
  // hook: page.after.delete
  public function pageAfterDelete($ctx) {
    $this->log("page.after.delete", $ctx);
  }

  // inspect or adjust site.json before it is written, or veto
  // hook: manifest.before.save
  public function manifestBeforeSave($ctx) {
    $this->log("manifest.before.save", $ctx);
  }

  // react to outline or settings changes: rebuild a derived file, notify
  // hook: manifest.after.save
  public function manifestAfterSave($ctx) {
    $this->log("manifest.after.save", $ctx);
  }

  // check the new theme is compatible, or veto
  // hook: theme.before.change
  public function themeBeforeChange($ctx) {
    $this->log("theme.before.change", $ctx);
  }

  // react to the new theme
  // hook: theme.after.change
  public function themeAfterChange($ctx) {
    $this->log("theme.after.change", $ctx);
  }

  // check type and size, rename, or veto
  // hook: file.before.save
  public function fileBeforeSave($ctx) {
    $this->log("file.before.save", $ctx);
  }

  // react to a new or changed file
  // hook: file.after.save
  public function fileAfterSave($ctx) {
    $this->log("file.after.save", $ctx);
  }

  // refuse while pages still embed the file, or veto
  // hook: file.before.delete
  public function fileBeforeDelete($ctx) {
    $this->log("file.before.delete", $ctx);
  }

  // remove derived files
  // hook: file.after.delete
  public function fileAfterDelete($ctx) {
    $this->log("file.after.delete", $ctx);
  }

  // uncommon: audit or restrict access to configuration
  // hook: config.before.read
  public function configBeforeRead($ctx) {
    $this->log("config.before.read", $ctx);
  }

  // uncommon: redact or annotate values for the caller
  // hook: config.after.read
  public function configAfterRead($ctx) {
    $this->log("config.after.read", $ctx);
  }

  // validate or normalize a settings change, or veto
  // hook: config.before.save
  public function configBeforeSave($ctx) {
    $this->log("config.before.save", $ctx);
    return $ctx->subject;
  }

  // react to a settings change: clear a cache, copy to a backup location
  // hook: config.after.save
  public function configAfterSave($ctx) {
    $this->log("config.after.save", $ctx);
  }

  // last chance to add files or adjust the commit message, or veto the commit
  // hook: git.before.commit
  public function gitBeforeCommit($ctx) {
    $this->log("git.before.commit", $ctx);
  }

  // push or rsync the site elsewhere; usually `detached: true`
  // hook: git.after.commit
  public function gitAfterCommit($ctx) {
    // detached: runs after the response is sent. A real plugin would spawn the declared command (exec: [rsync]) here.
    $this->log("git.after.commit", $ctx);
  }

  // check or adjust the request before the handler runs, or refuse it
  // hook: rest.before.request
  public function restBeforeRequest($ctx) {
    $this->log("rest.before.request", $ctx);
  }

  // adjust the response before it is sent; not detachable
  // hook: rest.after.request
  public function restAfterRequest($ctx) {
    $this->log("rest.after.request", $ctx);
  }

  // report unmet requirements; the plugin stays enabled but inactive until the list is empty
  // hook: plugin.before.requirements
  public function pluginBeforeRequirements($ctx) {
    $this->log("plugin.before.requirements", $ctx);
    $unmet = $ctx->subject;
    if (empty($ctx->settings["greeting"])) {
      $unmet[] = ["key" => "settings.greeting", "message" => "Set a greeting before this plugin activates"];
    }
    return $unmet;
  }

  // react to becoming active or inactive
  // hook: plugin.after.requirements
  public function pluginAfterRequirements($ctx) {
    $this->log("plugin.after.requirements", $ctx);
  }

  // check preconditions for install; veto to refuse
  // hook: plugin.before.install
  public function pluginBeforeInstall($ctx) {
    $this->log("plugin.before.install", $ctx);
  }

  // migrate settings that used to live in site.json or core config into this plugin's settings
  // hook: plugin.after.install
  public function pluginAfterInstall($ctx) {
    $this->log("plugin.after.install", $ctx);
  }

  // check preconditions for enable; veto to refuse
  // hook: plugin.before.enable
  public function pluginBeforeEnable($ctx) {
    $this->log("plugin.before.enable", $ctx);
  }

  // set up what the plugin needs at runtime
  // hook: plugin.after.enable
  public function pluginAfterEnable($ctx) {
    $this->log("plugin.after.enable", $ctx);
  }

  // check preconditions for disable; veto to refuse
  // hook: plugin.before.disable
  public function pluginBeforeDisable($ctx) {
    $this->log("plugin.before.disable", $ctx);
  }

  // tear down what enable set up; core clears caches and rebuilds managed outputs
  // hook: plugin.after.disable
  public function pluginAfterDisable($ctx) {
    $this->log("plugin.after.disable", $ctx);
  }

  // check preconditions for uninstall; veto to refuse
  // hook: plugin.before.uninstall
  public function pluginBeforeUninstall($ctx) {
    $this->log("plugin.before.uninstall", $ctx);
  }

  // remove anything outside the plugin's own stores
  // hook: plugin.after.uninstall
  public function pluginAfterUninstall($ctx) {
    $this->log("plugin.after.uninstall", $ctx);
  }

  // check preconditions for upgrade; veto to refuse
  // hook: plugin.before.upgrade
  public function pluginBeforeUpgrade($ctx) {
    $this->log("plugin.before.upgrade", $ctx);
  }

  // prepare for or follow up on data upgrades
  // hook: plugin.after.upgrade
  public function pluginAfterUpgrade($ctx) {
    $this->log("plugin.after.upgrade", $ctx);
  }

  // check or adjust before the site is created, or veto
  // hook: site.before.create
  public function siteBeforeCreate($ctx) {
    $this->log("site.before.create", $ctx);
  }

  // react after the site is created
  // hook: site.after.create
  public function siteAfterCreate($ctx) {
    $this->log("site.after.create", $ctx);
  }

  // check or adjust before the site is duplicated, or veto
  // hook: site.before.duplicate
  public function siteBeforeDuplicate($ctx) {
    $this->log("site.before.duplicate", $ctx);
  }

  // react after the site is duplicated
  // hook: site.after.duplicate
  public function siteAfterDuplicate($ctx) {
    $this->log("site.after.duplicate", $ctx);
  }

  // check or adjust before the site is archived, or veto
  // hook: site.before.archive
  public function siteBeforeArchive($ctx) {
    $this->log("site.before.archive", $ctx);
  }

  // react after the site is archived
  // hook: site.after.archive
  public function siteAfterArchive($ctx) {
    $this->log("site.after.archive", $ctx);
  }

  // check or adjust before the site is deleted, or veto
  // hook: site.before.delete
  public function siteBeforeDelete($ctx) {
    $this->log("site.before.delete", $ctx);
  }

  // react after the site is deleted
  // hook: site.after.delete
  public function siteAfterDelete($ctx) {
    $this->log("site.after.delete", $ctx);
  }

  // check or adjust before the site is exported, or veto
  // hook: site.before.export
  public function siteBeforeExport($ctx) {
    $this->log("site.before.export", $ctx);
  }

  // react after the site is exported
  // hook: site.after.export
  public function siteAfterExport($ctx) {
    $this->log("site.after.export", $ctx);
  }

  // refuse the login (for example outside allowed hours), or veto
  // hook: user.before.login
  public function userBeforeLogin($ctx) {
    $this->log("user.before.login", $ctx);
  }

  // react to the login: record it, warm a cache
  // hook: user.after.login
  public function userAfterLogin($ctx) {
    $this->log("user.after.login", $ctx);
  }

  // refuse the logout (for example outside allowed hours), or veto
  // hook: user.before.logout
  public function userBeforeLogout($ctx) {
    $this->log("user.before.logout", $ctx);
  }

  // react to the logout: record it, warm a cache
  // hook: user.after.logout
  public function userAfterLogout($ctx) {
    $this->log("user.after.logout", $ctx);
  }

  // add to the routes list
  // hook: register.before.routes
  public function registerBeforeRoutes($ctx) {
    $this->log("register.before.routes", $ctx);
  }

  // inspect the final routes list (audit, conflicts)
  // hook: register.after.routes
  public function registerAfterRoutes($ctx) {
    $this->log("register.after.routes", $ctx);
  }

  // add to the entities list
  // hook: register.before.entities
  public function registerBeforeEntities($ctx) {
    $this->log("register.before.entities", $ctx);
  }

  // inspect the final entities list (audit, conflicts)
  // hook: register.after.entities
  public function registerAfterEntities($ctx) {
    $this->log("register.after.entities", $ctx);
  }

  // add to the contracts list
  // hook: register.before.contracts
  public function registerBeforeContracts($ctx) {
    $this->log("register.before.contracts", $ctx);
  }

  // inspect the final contracts list (audit, conflicts)
  // hook: register.after.contracts
  public function registerAfterContracts($ctx) {
    $this->log("register.after.contracts", $ctx);
  }

  // add to the prompts list
  // hook: register.before.prompts
  public function registerBeforePrompts($ctx) {
    $this->log("register.before.prompts", $ctx);
    return $ctx->subject;
  }

  // inspect the final prompts list (audit, conflicts)
  // hook: register.after.prompts
  public function registerAfterPrompts($ctx) {
    $this->log("register.after.prompts", $ctx);
  }

  // serve a cached document with ctx.respond(html), or prepare the context
  // hook: render.before
  public function renderBefore($ctx) {
    $this->log("render.before", $ctx);
  }

  // add meta, link and script tags to the head
  // hook: render.before.head
  public function renderBeforeHead($ctx) {
    $this->log("render.before.head", $ctx);
  }

  // inspect or reorder the final head
  // hook: render.after.head
  public function renderAfterHead($ctx) {
    $this->log("render.after.head", $ctx);
  }

  // transform content before it is placed, for example server-side render custom elements
  // hook: render.before.content
  public function renderBeforeContent($ctx) {
    $this->log("render.before.content", $ctx);
  }

  // inspect or post-process the placed content
  // hook: render.after.content
  public function renderAfterContent($ctx) {
    $this->log("render.after.content", $ctx);
  }

  // inject markup at the start of the body
  // hook: render.before.body
  public function renderBeforeBody($ctx) {
    $this->log("render.before.body", $ctx);
  }

  // inject singletons and scripts at the end of the body, with settings baked in from the plugin's config
  // hook: render.after.body
  public function renderAfterBody($ctx) {
    $this->log("render.after.body", $ctx);
  }

  // last chance to alter the final document; store it in a cache
  // hook: render.after
  public function renderAfter($ctx) {
    $this->log("render.after", $ctx);
  }

  // prepare for a rebuild, or veto it
  // hook: rebuild.before
  public function rebuildBefore($ctx) {
    $this->log("rebuild.before", $ctx);
  }

  // write this plugin's own managed files
  // hook: rebuild.after
  public function rebuildAfter($ctx) {
    $this->log("rebuild.after", $ctx);
  }

  // skip a job run (for example during maintenance)
  // hook: schedule.before.run
  public function scheduleBeforeRun($ctx) {
    $this->log("schedule.before.run", $ctx);
  }

  // record the result or alert on failure
  // hook: schedule.after.run
  public function scheduleAfterRun($ctx) {
    $this->log("schedule.after.run", $ctx);
  }

  // make the explosion smaller, or veto it
  // hook: example.before.explode
  public function exampleBeforeExplode($ctx) {
    $this->log("example.before.explode", $ctx);
  }

  // react to an explosion
  // hook: example.after.explode
  public function exampleAfterExplode($ctx) {
    $this->log("example.after.explode", $ctx);
  }

  // same as entity.before.create/update on awesomeFile, under a clearer name
  // hook: example.before.awesomeSave
  public function exampleBeforeAwesomeSave($ctx) {
    $this->log("example.before.awesomeSave", $ctx);
  }
}
