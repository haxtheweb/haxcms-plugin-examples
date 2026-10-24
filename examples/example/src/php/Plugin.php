<?php
// Example plugin (PHP). Placeholder until the loader exists: every hook in schema/hooks.json is implemented.
// Each body logs; the comment says what you could do there.
class ExamplePlugin {
  private function log($name, $ctx = null) { error_log("[example] " . $name); }

  // validate or normalize input, or veto with a message
  // hook: entity.before.create
  public function entityBeforeCreate($ctx) {
    if (isset($ctx["subject"]["name"]) && $ctx["subject"]["name"] === "boring.awesome") {
      return ["veto" => true, "message" => "Too boring. Add more explosions."];
    }
    $this->log("entity.before.create", $ctx);
  }

  // react to the change, notify, or update a derived store
  // hook: entity.after.create
  public function entityAfterCreate($ctx) {
    $this->log("entity.after.create", $ctx);
  }

  // validate or normalize input, or veto with a message
  // hook: entity.before.read
  public function entityBeforeRead($ctx) {
    $this->log("entity.before.read", $ctx);
  }

  // react to the change, notify, or update a derived store
  // hook: entity.after.read
  public function entityAfterRead($ctx) {
    $this->log("entity.after.read", $ctx);
  }

  // validate or normalize input, or veto with a message
  // hook: entity.before.update
  public function entityBeforeUpdate($ctx) {
    $this->log("entity.before.update", $ctx);
  }

  // react to the change, notify, or update a derived store
  // hook: entity.after.update
  public function entityAfterUpdate($ctx) {
    $this->log("entity.after.update", $ctx);
  }

  // validate or normalize input, or veto with a message
  // hook: entity.before.delete
  public function entityBeforeDelete($ctx) {
    $this->log("entity.before.delete", $ctx);
  }

  // react to the change, notify, or update a derived store
  // hook: entity.after.delete
  public function entityAfterDelete($ctx) {
    $this->log("entity.after.delete", $ctx);
  }

  // inspect or reject the request before routing (never log secrets)
  // hook: rest.request
  public function restRequest($ctx) {
    $this->log("rest.request", $ctx);
  }

  // add headers or trim fields before the response is sent
  // hook: rest.response
  public function restResponse($ctx) {
    $this->log("rest.response", $ctx);
  }

  // runs the first time the plugin is enabled in a scope (site or system); migrate settings that used to live in site.json or core config into this plugin's settings here
  // hook: plugin.before.install
  public function pluginBeforeInstall($ctx) {
    $this->log("plugin.before.install", $ctx);
  }

  // runs the first time the plugin is enabled in a scope (site or system); migrate settings that used to live in site.json or core config into this plugin's settings here
  // hook: plugin.after.install
  public function pluginAfterInstall($ctx) {
    $this->log("plugin.after.install", $ctx);
  }

  // check preconditions; throw to refuse the transition
  // hook: plugin.before.enable
  public function pluginBeforeEnable($ctx) {
    $this->log("plugin.before.enable", $ctx);
  }

  // finish setup, warm caches, or observe another plugin
  // hook: plugin.after.enable
  public function pluginAfterEnable($ctx) {
    $this->log("plugin.after.enable", $ctx);
  }

  // check preconditions; throw to refuse the transition
  // hook: plugin.before.disable
  public function pluginBeforeDisable($ctx) {
    $this->log("plugin.before.disable", $ctx);
  }

  // finish setup, warm caches, or observe another plugin
  // hook: plugin.after.disable
  public function pluginAfterDisable($ctx) {
    $this->log("plugin.after.disable", $ctx);
  }

  // check preconditions; throw to refuse the transition
  // hook: plugin.before.uninstall
  public function pluginBeforeUninstall($ctx) {
    $this->log("plugin.before.uninstall", $ctx);
  }

  // finish setup, warm caches, or observe another plugin
  // hook: plugin.after.uninstall
  public function pluginAfterUninstall($ctx) {
    $this->log("plugin.after.uninstall", $ctx);
  }

  // check preconditions; throw to refuse the transition
  // hook: plugin.before.upgrade
  public function pluginBeforeUpgrade($ctx) {
    $this->log("plugin.before.upgrade", $ctx);
  }

  // finish setup, warm caches, or observe another plugin
  // hook: plugin.after.upgrade
  public function pluginAfterUpgrade($ctx) {
    $this->log("plugin.after.upgrade", $ctx);
  }

  // validate the action or prepare data; veto if needed
  // hook: site.before.create
  public function siteBeforeCreate($ctx) {
    $this->log("site.before.create", $ctx);
  }

  // copy, archive or clean up plugin data for the site
  // hook: site.after.create
  public function siteAfterCreate($ctx) {
    $this->log("site.after.create", $ctx);
  }

  // validate the action or prepare data; veto if needed
  // hook: site.before.duplicate
  public function siteBeforeDuplicate($ctx) {
    $this->log("site.before.duplicate", $ctx);
  }

  // copy, archive or clean up plugin data for the site
  // hook: site.after.duplicate
  public function siteAfterDuplicate($ctx) {
    $this->log("site.after.duplicate", $ctx);
  }

  // validate the action or prepare data; veto if needed
  // hook: site.before.archive
  public function siteBeforeArchive($ctx) {
    $this->log("site.before.archive", $ctx);
  }

  // copy, archive or clean up plugin data for the site
  // hook: site.after.archive
  public function siteAfterArchive($ctx) {
    $this->log("site.after.archive", $ctx);
  }

  // validate the action or prepare data; veto if needed
  // hook: site.before.delete
  public function siteBeforeDelete($ctx) {
    $this->log("site.before.delete", $ctx);
  }

  // copy, archive or clean up plugin data for the site
  // hook: site.after.delete
  public function siteAfterDelete($ctx) {
    $this->log("site.after.delete", $ctx);
  }

  // validate the action or prepare data; veto if needed
  // hook: site.before.export
  public function siteBeforeExport($ctx) {
    $this->log("site.before.export", $ctx);
  }

  // copy, archive or clean up plugin data for the site
  // hook: site.after.export
  public function siteAfterExport($ctx) {
    $this->log("site.after.export", $ctx);
  }

  // apply rate limiting or extra checks
  // hook: user.before.login
  public function userBeforeLogin($ctx) {
    $this->log("user.before.login", $ctx);
  }

  // record an audit entry
  // hook: user.after.login
  public function userAfterLogin($ctx) {
    $this->log("user.after.login", $ctx);
  }

  // apply rate limiting or extra checks
  // hook: user.before.logout
  public function userBeforeLogout($ctx) {
    $this->log("user.before.logout", $ctx);
  }

  // record an audit entry
  // hook: user.after.logout
  public function userAfterLogout($ctx) {
    $this->log("user.after.logout", $ctx);
  }

  // declare what this plugin provides to the platform
  // hook: register.routes
  public function registerRoutes($ctx) {
    $this->log("register.routes", $ctx);
  }

  // declare what this plugin provides to the platform
  // hook: register.entities
  public function registerEntities($ctx) {
    $this->log("register.entities", $ctx);
  }

  // declare what this plugin provides to the platform
  // hook: register.contracts
  public function registerContracts($ctx) {
    $this->log("register.contracts", $ctx);
  }

  // serve a cached document by returning ctx.respond(html), or prepare the render context (site, page, theme)
  // hook: render.before
  public function renderBefore($ctx) {
    $this->log("render.before", $ctx);
  }

  // add or alter head tags and slim CSS variables
  // hook: render.head
  public function renderHead($ctx) {
    $this->log("render.head", $ctx);
  }

  // transform the assembled page content before it is placed in the shell (for example server-side render custom elements)
  // hook: render.content
  public function renderContent($ctx) {
    $this->log("render.content", $ctx);
  }

  // inject markup right after the opening body tag
  // hook: render.body.start
  public function renderBodyStart($ctx) {
    $this->log("render.body.start", $ctx);
  }

  // inject singletons and scripts at the bottom of the body, with settings baked in from the plugin's config
  // hook: render.body.end
  public function renderBodyEnd($ctx) {
    $this->log("render.body.end", $ctx);
  }

  // last chance to alter the final document; store it in a cache for the next request or for publishing
  // hook: render.after
  public function renderAfter($ctx) {
    $this->log("render.after", $ctx);
  }

  // write or clean managed files (needs output:managedFiles)
  // hook: rebuild.before
  public function rebuildBefore($ctx) {
    $this->log("rebuild.before", $ctx);
  }

  // write or clean managed files (needs output:managedFiles)
  // hook: rebuild.after
  public function rebuildAfter($ctx) {
    $this->log("rebuild.after", $ctx);
  }

  // reserved: runner not implemented; keep jobs idempotent
  // hook: schedule.run
  public function scheduleRun($ctx) {
    $this->log("schedule.run", $ctx);
  }

  // inspect or adjust the page by reference before it is written, or veto
  // hook: page.before.save
  public function pageBeforeSave($ctx) {
    $this->log("page.before.save", $ctx);
  }

  // react once the page is saved (sync, notify, rebuild derived data)
  // hook: page.after.save
  public function pageAfterSave($ctx) {
    $this->log("page.after.save", $ctx);
  }

  // inspect or adjust the manifest by reference before it is written, or veto
  // hook: manifest.before.save
  public function manifestBeforeSave($ctx) {
    $this->log("manifest.before.save", $ctx);
  }

  // react once the manifest is saved
  // hook: manifest.after.save
  public function manifestAfterSave($ctx) {
    $this->log("manifest.after.save", $ctx);
  }

  // last chance to add files or adjust the commit message
  // hook: git.before.commit
  public function gitBeforeCommit($ctx) {
    $this->log("git.before.commit", $ctx);
  }

  // runs after every git commit HAXcms makes (after an item or manifest save); for example rsync the site to a remote server
  // hook: git.after.commit
  public function gitAfterCommit($ctx) {
    $this->log("git.after.commit", $ctx);
  }
}
