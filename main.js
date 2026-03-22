const { Plugin, PluginSettingTab, Setting, Notice } = require("obsidian");
const fs = require("fs");
const path = require("path");

const DEFAULT_SETTINGS = {
  propertyConfigs: [],
  badgeSize: 20,
  iconFolder: "assets/icons",
  storageLocation: "vault",
  keepRatio: false,
};

module.exports = class BadgePlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new BadgeSettingTab(this.app, this));

    // Shared tooltip
    this._tooltip = document.createElement("div");
    this._tooltip.className = "badge-plugin-tooltip";
    Object.assign(this._tooltip.style, {
      position:      "fixed",
      zIndex:        "99999",
      display:       "none",
      flexDirection: "column",
      alignItems:    "center",
      gap:           "6px",
      background:    "var(--background-primary)",
      border:        "1px solid var(--background-modifier-border)",
      borderRadius:  "8px",
      padding:       "10px 12px",
      boxShadow:     "0 8px 24px rgba(0,0,0,0.3)",
      pointerEvents: "none",
      maxWidth:      "180px",
      textAlign:     "center",
      opacity:       "0",
      transition:    "opacity 0.12s ease",
    });
    document.body.appendChild(this._tooltip);

    // Notes: markdown post-processor
    this.registerMarkdownPostProcessor((el) => {
      setTimeout(() => this.processNoteEl(el), 100);
    });

    // Notes: also observe markdown leaves for property panel changes
    this._noteObserver = new MutationObserver(() => {
      document.querySelectorAll(".workspace-leaf-content[data-type='markdown']").forEach((leaf) => {
        this.processNoteEl(leaf);
      });
    });
    const markdownLeaf = document.querySelector(".workspace-leaf-content[data-type='markdown']");
    if (markdownLeaf) {
      this._noteObserver.observe(markdownLeaf, { childList: true, subtree: true });
    }

    // Bases: simple interval poll — no observer, just scan every 500ms
    this._basesInterval = window.setInterval(() => this.processAllBasesLeaves(), 500);

    console.log("Badge plugin loaded");
  }

  onunload() {
    if (this._noteObserver) this._noteObserver.disconnect();
    if (this._basesInterval) window.clearInterval(this._basesInterval);
    if (this._tooltip) this._tooltip.remove();
  }

  // ── Process all open Bases leaves ───────────────────────────────────────────

  processAllBasesLeaves() {
    document.querySelectorAll(".workspace-leaf-content[data-type='bases']").forEach((leaf) => {
      this.processBasesEl(leaf);
    });
  }

  processBasesEl(leafEl) {
    for (const config of this.settings.propertyConfigs) {
      if (!config.key) continue;
      leafEl.querySelectorAll(`[data-property="note.${config.key}"]`).forEach((container) => {
        container.querySelectorAll("span.value-list-element[data-property-pill-value]").forEach((el) => {
          if (el.querySelector("img.badge-icon")) return;
          const text = el.getAttribute("data-property-pill-value") || el.innerText.trim();
          this.applyBadge(el, text, config, config.showTagText ?? false);
        });
      });
    }
  }

  // ── Process note properties panel ───────────────────────────────────────────

  processNoteEl(root) {
    for (const config of this.settings.propertyConfigs) {
      if (!config.key) continue;
      root.querySelectorAll(`[data-property-key="${config.key}"]`).forEach((prop) => {
        prop.querySelectorAll(".multi-select-pill").forEach((pill) => {
          const content = pill.querySelector(".multi-select-pill-content");
          if (!content) return;
          this.applyBadge(content, content.innerText.trim(), config, false);
        });
      });
    }
  }

  // ── Core badge injection ─────────────────────────────────────────────────────

  applyBadge(targetEl, text, config, keepText) {
    if (!text) return;
    if (targetEl.querySelector("img.badge-icon")) return;

    const mapping = (config.mappings || []).find(
      (m) => m.text.toLowerCase() === text.toLowerCase()
    );
    if (!mapping || !mapping.icon) return;

    const url = this.getIconUrl(mapping.icon);
    if (!url) {
      console.error("Badge: icon URL not resolved for", mapping.icon);
      return;
    }

    const img = document.createElement("img");
    img.src = url;
    img.classList.add("badge-icon");
    img.setAttribute("data-badge-value", text);
    img.style.cursor        = "default";
    img.style.display       = "inline-block";
    img.style.verticalAlign = "middle";
    img.style.flexShrink    = "0";
    this.applyBadgeSize(img);

    img.onerror = () => console.error("Badge: image failed to load:", url);
    img.addEventListener("mouseenter", () => this.showTooltip(img, url, text));
    img.addEventListener("mouseleave", () => this.hideTooltip());

    targetEl.innerHTML = "";

    if (keepText) {
      const wrapper = document.createElement("span");
      wrapper.style.display    = "inline-flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap        = "4px";
      const textNode = document.createElement("span");
      textNode.textContent = text;
      wrapper.appendChild(img);
      wrapper.appendChild(textNode);
      targetEl.appendChild(wrapper);
    } else {
      targetEl.appendChild(img);
    }
  }

  // ── Tooltip ──────────────────────────────────────────────────────────────────

  showTooltip(anchorEl, imgSrc, label) {
    const tt = this._tooltip;
    tt.innerHTML = "";

    const previewImg = document.createElement("img");
    previewImg.src = imgSrc;
    Object.assign(previewImg.style, {
      maxWidth:     "120px",
      maxHeight:    "120px",
      width:        this.settings.keepRatio ? "auto" : "80px",
      height:       this.settings.keepRatio ? "120px" : "80px",
      objectFit:    this.settings.keepRatio ? "contain" : "cover",
      borderRadius: "4px",
      display:      "block",
    });

    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    Object.assign(labelEl.style, {
      fontSize:   "12px",
      color:      "var(--text-normal)",
      fontWeight: "500",
      wordBreak:  "break-word",
    });

    tt.appendChild(previewImg);
    tt.appendChild(labelEl);
    tt.style.display = "flex";

    const rect = anchorEl.getBoundingClientRect();
    const TT_W = 180, TT_H = 160, MARGIN = 10;
    let left = rect.left + rect.width / 2 - TT_W / 2;
    let top  = rect.top - TT_H - MARGIN;
    if (top < 8) top = rect.bottom + MARGIN;
    left = Math.max(8, Math.min(left, window.innerWidth - TT_W - 8));

    tt.style.left = left + "px";
    tt.style.top  = top  + "px";

    requestAnimationFrame(() => { tt.style.opacity = "1"; });
  }

  hideTooltip() {
    this._tooltip.style.opacity = "0";
    setTimeout(() => {
      if (this._tooltip.style.opacity === "0") this._tooltip.style.display = "none";
    }, 130);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  applyBadgeSize(img) {
    const size = this.settings.badgeSize;
    if (this.settings.keepRatio) {
      img.style.width  = "auto";
      img.style.height = size + "px";
    } else {
      img.style.width     = size + "px";
      img.style.height    = size + "px";
      img.style.objectFit = "cover";
    }
  }

  getIconFolderFsPath() {
    const basePath = this.app.vault.adapter.basePath;
    if (this.settings.storageLocation === "plugin") {
      return path.join(basePath, ".obsidian", "plugins", this.manifest.id, "assets", "icons");
    }
    return path.join(basePath, this.settings.iconFolder);
  }

  getIconUrl(iconFileName) {
    if (this.settings.storageLocation === "plugin") {
      const fsPath = path.join(this.getIconFolderFsPath(), iconFileName);
      const basePath = this.app.vault.adapter.basePath;
      const rel = path.relative(basePath, fsPath).replace(/\\/g, "/");
      return this.app.vault.adapter.getResourcePath(rel);
    }
    const vaultPath = `${this.settings.iconFolder}/${iconFileName}`;
    const file = this.app.vault.getAbstractFileByPath(vaultPath);
    if (!file) return null;
    return this.app.vault.getResourcePath(file);
  }

  deleteIconFile(iconFileName) {
    const fsPath = path.join(this.getIconFolderFsPath(), iconFileName);
    try {
      if (fs.existsSync(fsPath)) { fs.unlinkSync(fsPath); return true; }
    } catch (e) { console.error("Badge: failed to delete icon:", e); }
    return false;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Migrate old flat format if needed
    if (!this.settings.propertyConfigs) {
      this.settings.propertyConfigs = (this.settings.properties || []).map((key) => ({
        key,
        showTagText: false,
        mappings: (this.settings.mappings || []),
      }));
      delete this.settings.properties;
      delete this.settings.mappings;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    new Notice("Settings saved");
  }
};

// ── Settings tab ─────────────────────────────────────────────────────────────

class BadgeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Property Badge" });

    // ── Global ────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Global" });

    new Setting(containerEl)
      .setName("Badge size (px)")
      .setDesc("Height in pixels. Width follows the ratio setting.")
      .addText((t) =>
        t.setValue(this.plugin.settings.badgeSize.toString())
          .onChange((v) => { this.plugin.settings.badgeSize = parseInt(v) || 20; })
      );

    new Setting(containerEl)
      .setName("Keep image ratio")
      .setDesc("ON = preserve aspect ratio. OFF = force square.")
      .addToggle((tog) =>
        tog.setValue(this.plugin.settings.keepRatio)
          .onChange((v) => { this.plugin.settings.keepRatio = v; })
      );

    // ── Storage ───────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Icon Storage" });

    let vaultFolderSetting;

    new Setting(containerEl)
      .setName("Storage location")
      .addDropdown((drop) =>
        drop
          .addOption("vault", "Vault folder")
          .addOption("plugin", "Plugin folder")
          .setValue(this.plugin.settings.storageLocation)
          .onChange((v) => {
            this.plugin.settings.storageLocation = v;
            if (vaultFolderSetting)
              vaultFolderSetting.settingEl.style.display = v === "vault" ? "" : "none";
          })
      );

    vaultFolderSetting = new Setting(containerEl)
      .setName("Vault icon folder")
      .setDesc("Path relative to vault root. Only used when Storage = Vault folder.")
      .addText((t) =>
        t.setPlaceholder("assets/icons")
          .setValue(this.plugin.settings.iconFolder)
          .onChange((v) => { this.plugin.settings.iconFolder = v || "assets/icons"; })
      );

    if (this.plugin.settings.storageLocation === "plugin")
      vaultFolderSetting.settingEl.style.display = "none";

    // ── Per-property configs ──────────────────────────────────
    containerEl.createEl("h3", { text: "Properties" });

    const configs = this.plugin.settings.propertyConfigs;

    configs.forEach((config, ci) => {
      // Property section header
      const section = containerEl.createEl("div");
      section.style.cssText = "margin-bottom: 16px; border: 1px solid var(--background-modifier-border); border-radius: 8px; overflow: hidden;";

      const header = section.createEl("div");
      header.style.cssText = "display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--background-secondary);";

      const keyInput = header.createEl("input");
      keyInput.type        = "text";
      keyInput.placeholder = "Property key (e.g. Badge)";
      keyInput.value       = config.key;
      keyInput.style.cssText = "flex:1; background:var(--background-primary); border:1px solid var(--background-modifier-border); border-radius:4px; padding:4px 8px; color:var(--text-normal); font-size:13px;";
      keyInput.addEventListener("change", (e) => { configs[ci].key = e.target.value.trim(); });

      const showTextLabel = header.createEl("label");
      showTextLabel.style.cssText = "display:flex; align-items:center; gap:4px; font-size:12px; color:var(--text-muted); white-space:nowrap; cursor:pointer;";
      const showTextToggle = showTextLabel.createEl("input");
      showTextToggle.type    = "checkbox";
      showTextToggle.checked = config.showTagText || false;
      showTextToggle.addEventListener("change", (e) => { configs[ci].showTagText = e.target.checked; });
      showTextLabel.appendText("Show text in Bases");

      const removePropBtn = header.createEl("button");
      removePropBtn.textContent = "✕";
      removePropBtn.title = "Remove this property";
      removePropBtn.style.cssText = "padding:2px 8px; color:var(--text-error); background:none; border:1px solid var(--text-error); border-radius:4px; cursor:pointer; font-size:12px;";
      removePropBtn.addEventListener("click", async () => {
        configs.splice(ci, 1);
        await this.plugin.saveSettings();
        this.display();
      });

      // Mappings area
      const mappingArea = section.createEl("div");
      mappingArea.style.cssText = "padding: 8px 12px;";

      (config.mappings || []).forEach((m, mi) => {
        const row = new Setting(mappingArea);
        row.setName(`Mapping ${mi + 1}`);

        row.addText((t) =>
          t.setPlaceholder("Tag value (e.g. ok)")
            .setValue(m.text)
            .onChange((v) => { configs[ci].mappings[mi].text = v; })
        );

        if (m.icon) {
          const url = this.plugin.getIconUrl(m.icon);
          if (url) {
            const img = document.createElement("img");
            img.src = url;
            img.style.cssText = `height:24px; width:${this.plugin.settings.keepRatio ? "auto" : "24px"}; object-fit:cover; margin-left:8px; border-radius:3px; vertical-align:middle;`;
            row.controlEl.appendChild(img);
          }
        }

        row.addButton((btn) =>
          btn.setButtonText("Upload icon").onClick(() => this.uploadIcon(ci, mi))
        );

        row.addButton((btn) =>
          btn.setButtonText("Remove").setWarning().onClick(async () => {
            const mapping = configs[ci].mappings[mi];
            if (mapping.icon) {
              const deleted = this.plugin.deleteIconFile(mapping.icon);
              new Notice(deleted ? `Deleted: ${mapping.icon}` : `File not found — mapping removed.`);
            }
            configs[ci].mappings.splice(mi, 1);
            await this.plugin.saveSettings();
            this.display();
          })
        );
      });

      new Setting(mappingArea).addButton((btn) =>
        btn.setButtonText("+ Add mapping").onClick(() => {
          configs[ci].mappings = configs[ci].mappings || [];
          configs[ci].mappings.push({ text: "", icon: "" });
          this.display();
        })
      );
    });

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("+ Add property").onClick(() => {
        configs.push({ key: "", showTagText: false, mappings: [] });
        this.display();
      })
    );

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("Save all settings").setCta().onClick(async () => {
        await this.plugin.saveSettings();
      })
    );
  }

  async uploadIcon(configIndex, mappingIndex) {
    const input = document.createElement("input");
    input.type   = "file";
    input.accept = "image/*";

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const buffer  = Buffer.from(await file.arrayBuffer());
      const iconDir = this.plugin.getIconFolderFsPath();
      if (!fs.existsSync(iconDir)) fs.mkdirSync(iconDir, { recursive: true });
      fs.writeFileSync(path.join(iconDir, file.name), buffer);
      this.plugin.settings.propertyConfigs[configIndex].mappings[mappingIndex].icon = file.name;
      new Notice(`Icon saved: ${file.name}`);
      this.display();
    };

    input.click();
  }
}