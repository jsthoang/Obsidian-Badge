const { Plugin, PluginSettingTab, Setting, Notice } = require("obsidian");
const fs = require("fs");
const path = require("path");

const DEFAULT_SETTINGS = {
  properties: [],
  mappings: [],
  badgeSize: 20,
  iconFolder: "assets/icons",
  storageLocation: "vault", // "vault" | "plugin"
  keepRatio: false          // false = square, true = keep original ratio
};

module.exports = class BadgePlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new BadgeSettingTab(this.app, this));

    // Single shared tooltip element
    this._tooltip = document.createElement("div");
    this._tooltip.className = "badge-plugin-tooltip";
    Object.assign(this._tooltip.style, {
      position:       "fixed",
      zIndex:         "99999",
      display:        "none",
      flexDirection:  "column",
      alignItems:     "center",
      gap:            "6px",
      background:     "var(--background-primary)",
      border:         "1px solid var(--background-modifier-border)",
      borderRadius:   "8px",
      padding:        "10px 12px",
      boxShadow:      "0 8px 24px rgba(0,0,0,0.3)",
      pointerEvents:  "none",
      maxWidth:       "180px",
      textAlign:      "center",
      opacity:        "0",
      transition:     "opacity 0.12s ease",
    });
    document.body.appendChild(this._tooltip);

    this.registerMarkdownPostProcessor((el) => {
      setTimeout(() => this.process(el), 100);
    });

    this._observer = new MutationObserver(() => {
      this.process(document.body);
    });
    this._observer.observe(document.body, { childList: true, subtree: true });

    console.log("Badge plugin loaded");
  }

  onunload() {
    if (this._observer) this._observer.disconnect();
    if (this._tooltip) this._tooltip.remove();
  }

  // ── Tooltip ────────────────────────────────────────────────

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

    // Position: above the anchor, centered, clamped to viewport
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
      if (this._tooltip.style.opacity === "0") {
        this._tooltip.style.display = "none";
      }
    }, 130);
  }

  // ── Badge injection ────────────────────────────────────────

  /**
   * Inject a badge image into targetEl, replacing its inner content.
   * @param {Element} targetEl - element whose content gets replaced
   * @param {string}  text     - tag/pill value to match against mappings
   */
  applyBadge(targetEl, text) {
    if (!text) return;
    if (targetEl.querySelector("img.badge-icon")) return; // already processed

    const mapping = this.settings.mappings.find(
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
    img.style.cursor       = "default";
    img.style.display      = "inline-block";
    img.style.verticalAlign = "middle";
    this.applyBadgeSize(img);

    img.onerror = () => console.error("Badge: image failed to load:", url);
    img.addEventListener("mouseenter", () => this.showTooltip(img, url, text));
    img.addEventListener("mouseleave", () => this.hideTooltip());

    targetEl.innerHTML = "";
    targetEl.appendChild(img);
  }

  process(root) {
    // ── 1. Standard properties panel ─────────────────────────
    // [data-property-key] -> .multi-select-pill -> .multi-select-pill-content
    root.querySelectorAll("[data-property-key]").forEach((prop) => {
      const key = prop.getAttribute("data-property-key");
      if (!this.settings.properties.includes(key)) return;

      prop.querySelectorAll(".multi-select-pill").forEach((pill) => {
        const content = pill.querySelector(".multi-select-pill-content");
        if (!content) return;
        this.applyBadge(content, content.innerText.trim());
      });
    });

    // ── 2. Bases card / gallery view ─────────────────────────
    // [data-property="note.Key"] -> .value-list-element[data-property-pill-value="value"]
    root.querySelectorAll("[data-property-pill-value]").forEach((el) => {
      if (el.querySelector("img.badge-icon")) return;

      const container = el.closest("[data-property]");
      if (!container) return;

      // "note.Badge" -> "Badge"
      const rawProp = container.getAttribute("data-property") || "";
      const key = rawProp.includes(".")
        ? rawProp.split(".").slice(1).join(".")
        : rawProp;

      if (!this.settings.properties.includes(key)) return;

      const text = el.getAttribute("data-property-pill-value") || el.innerText.trim();
      this.applyBadge(el, text);
    });

    // ── 3. Bases table / other views (fallback) ───────────────
    // [data-property="note.Key"] cells with no pill-value children
    root.querySelectorAll("[data-property]").forEach((container) => {
      if (container.querySelector("[data-property-pill-value]")) return;

      const rawProp = container.getAttribute("data-property") || "";
      const key = rawProp.includes(".")
        ? rawProp.split(".").slice(1).join(".")
        : rawProp;
      if (!this.settings.properties.includes(key)) return;

      container.querySelectorAll(".value-list-element, .bases-rendered-value span").forEach((span) => {
        if (span.querySelector("img.badge-icon")) return;
        this.applyBadge(span, span.innerText.trim());
      });
    });
  }

  // ── Helpers ────────────────────────────────────────────────

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
      if (fs.existsSync(fsPath)) {
        fs.unlinkSync(fsPath);
        console.log("Deleted icon:", fsPath);
        return true;
      }
    } catch (e) {
      console.error("Failed to delete icon:", e);
    }
    return false;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    new Notice("Settings saved");
  }
};

// ── Settings tab ───────────────────────────────────────────────────────────────

class BadgeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Property Badge" });

    // Properties
    new Setting(containerEl)
      .setName("Tracked properties")
      .setDesc("Comma-separated property keys to apply badges to (e.g. status,priority,Badge)")
      .addTextArea((ta) => {
        ta.setValue(this.plugin.settings.properties.join(", "))
          .onChange((v) => {
            this.plugin.settings.properties = v.split(",").map((s) => s.trim()).filter(Boolean);
          });
        ta.inputEl.style.width = "100%";
        ta.inputEl.rows = 2;
      });

    // Badge size
    new Setting(containerEl)
      .setName("Badge size (px)")
      .setDesc("Height in pixels. Width follows ratio setting.")
      .addText((t) =>
        t.setValue(this.plugin.settings.badgeSize.toString())
          .onChange((v) => { this.plugin.settings.badgeSize = parseInt(v) || 20; })
      );

    // Keep ratio
    new Setting(containerEl)
      .setName("Keep image ratio")
      .setDesc("ON = preserve aspect ratio. OFF = force square.")
      .addToggle((tog) =>
        tog.setValue(this.plugin.settings.keepRatio)
          .onChange((v) => { this.plugin.settings.keepRatio = v; })
      );

    // Storage location
    containerEl.createEl("h3", { text: "Icon Storage" });

    let vaultFolderSetting;

    new Setting(containerEl)
      .setName("Storage location")
      .setDesc(
        "Vault: icons stored in vault folder (visible in file explorer). " +
        "Plugin: icons stored inside plugin folder (hidden from vault, persists across vault moves)."
      )
      .addDropdown((drop) =>
        drop
          .addOption("vault", "Vault folder")
          .addOption("plugin", "Plugin folder")
          .setValue(this.plugin.settings.storageLocation)
          .onChange((v) => {
            this.plugin.settings.storageLocation = v;
            if (vaultFolderSetting) {
              vaultFolderSetting.settingEl.style.display = v === "vault" ? "" : "none";
            }
          })
      );

    vaultFolderSetting = new Setting(containerEl)
      .setName("Vault icon folder")
      .setDesc("Path relative to vault root (only used when storage = Vault folder)")
      .addText((t) =>
        t.setPlaceholder("assets/icons")
          .setValue(this.plugin.settings.iconFolder)
          .onChange((v) => { this.plugin.settings.iconFolder = v || "assets/icons"; })
      );

    if (this.plugin.settings.storageLocation === "plugin") {
      vaultFolderSetting.settingEl.style.display = "none";
    }

    // Mappings
    containerEl.createEl("h3", { text: "Badge Mappings" });

    this.plugin.settings.mappings.forEach((m, index) => {
      const setting = new Setting(containerEl).setName(`Mapping ${index + 1}`);

      setting.addText((t) =>
        t.setPlaceholder("Tag value (e.g. ok)")
          .setValue(m.text)
          .onChange((v) => { this.plugin.settings.mappings[index].text = v; })
      );

      // Icon preview
      if (m.icon) {
        const url = this.plugin.getIconUrl(m.icon);
        if (url) {
          const img = document.createElement("img");
          img.src = url;
          img.style.height       = "24px";
          img.style.width        = this.plugin.settings.keepRatio ? "auto" : "24px";
          img.style.objectFit    = "cover";
          img.style.marginLeft   = "8px";
          img.style.borderRadius = "3px";
          img.style.verticalAlign = "middle";
          setting.controlEl.appendChild(img);
        }
      }

      // Upload icon
      setting.addButton((btn) =>
        btn.setButtonText("Upload icon").onClick(() => this.uploadIcon(index))
      );

      // Remove mapping + delete file
      setting.addButton((btn) =>
        btn.setButtonText("Remove").setWarning().onClick(async () => {
          const mapping = this.plugin.settings.mappings[index];
          if (mapping.icon) {
            const deleted = this.plugin.deleteIconFile(mapping.icon);
            new Notice(deleted
              ? `Deleted icon: ${mapping.icon}`
              : `Icon file not found on disk — mapping removed anyway.`
            );
          }
          this.plugin.settings.mappings.splice(index, 1);
          await this.plugin.saveSettings();
          this.display();
        })
      );
    });

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("+ Add mapping").onClick(() => {
        this.plugin.settings.mappings.push({ text: "", icon: "" });
        this.display();
      })
    );

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("Save all settings").setCta().onClick(async () => {
        await this.plugin.saveSettings();
      })
    );
  }

  async uploadIcon(index) {
    const input = document.createElement("input");
    input.type   = "file";
    input.accept = "image/*";

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      const buffer  = Buffer.from(await file.arrayBuffer());
      const iconDir = this.plugin.getIconFolderFsPath();

      if (!fs.existsSync(iconDir)) fs.mkdirSync(iconDir, { recursive: true });

      const dest = path.join(iconDir, file.name);
      fs.writeFileSync(dest, buffer);

      this.plugin.settings.mappings[index].icon = file.name;
      new Notice(`Icon saved: ${file.name}`);
      this.display();
    };

    input.click();
  }
}