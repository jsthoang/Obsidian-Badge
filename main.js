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

    this.registerMarkdownPostProcessor((el) => {
      setTimeout(() => this.process(el), 100);
    });

    this.observer = new MutationObserver(() => {
      this.process(document.body);
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log("Badge plugin loaded");
  }

  onunload() {
    if (this.observer) this.observer.disconnect();
  }

  // Resolve the actual filesystem path for the icon folder
  getIconFolderFsPath() {
    const basePath = this.app.vault.adapter.basePath;
    if (this.settings.storageLocation === "plugin") {
      // Store inside plugin directory
      return path.join(basePath, ".obsidian", "plugins", this.manifest.id, "assets", "icons");
    } else {
      // Store inside vault
      return path.join(basePath, this.settings.iconFolder);
    }
  }

  // Resolve the vault-relative path used by Obsidian's file APIs (only valid for vault mode)
  getIconFolderVaultPath() {
    return this.settings.iconFolder;
  }

  // Get the resource URL for an icon filename
  getIconUrl(iconFileName) {
    if (this.settings.storageLocation === "plugin") {
      const fsPath = path.join(this.getIconFolderFsPath(), iconFileName);
      // Use app:// protocol directly for plugin-local files
      const basePath = this.app.vault.adapter.basePath;
      const relativeToBases = path.relative(basePath, fsPath).replace(/\\/g, "/");
      // Obsidian exposes vault resources via adapter.getResourcePath
      return this.app.vault.adapter.getResourcePath(relativeToBases);
    } else {
      const vaultPath = `${this.settings.iconFolder}/${iconFileName}`;
      const file = this.app.vault.getAbstractFileByPath(vaultPath);
      if (!file) return null;
      return this.app.vault.getResourcePath(file);
    }
  }

  process(root) {
    const props = root.querySelectorAll("[data-property-key]");

    props.forEach((prop) => {
      const key = prop.getAttribute("data-property-key");
      if (!this.settings.properties.includes(key)) return;

      const pills = prop.querySelectorAll(".multi-select-pill");

      pills.forEach((pill) => {
        const content = pill.querySelector(".multi-select-pill-content");
        if (!content) return;

        const text = content.innerText.trim();
        const mapping = this.settings.mappings.find(
          (m) => m.text.toLowerCase() === text.toLowerCase()
        );

        if (!mapping || !mapping.icon) return;
        if (content.querySelector("img")) return;

        const url = this.getIconUrl(mapping.icon);
        if (!url) {
          console.error("❌ Icon URL not resolved for:", mapping.icon);
          return;
        }

        const img = document.createElement("img");
        img.src = url;
        img.setAttribute("data-name", text);
        img.classList.add("badge-icon");

        this.applyBadgeSize(img);

        img.onerror = () => console.error("❌ Image failed:", url);

        content.innerHTML = "";
        content.appendChild(img);
      });
    });
  }

  applyBadgeSize(img) {
    const size = this.settings.badgeSize;
    if (this.settings.keepRatio) {
      img.style.width = "auto";
      img.style.height = size + "px";
    } else {
      img.style.width = size + "px";
      img.style.height = size + "px";
      img.style.objectFit = "cover";
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    new Notice("✅ Settings saved");
  }

  // Delete icon file from disk
  deleteIconFile(iconFileName) {
    const fsPath = path.join(this.getIconFolderFsPath(), iconFileName);
    try {
      if (fs.existsSync(fsPath)) {
        fs.unlinkSync(fsPath);
        console.log("🗑️ Deleted icon:", fsPath);
        return true;
      }
    } catch (e) {
      console.error("❌ Failed to delete icon:", e);
    }
    return false;
  }
};

class BadgeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Property Badge Settings" });

    // ── Properties ──────────────────────────────────────────
    new Setting(containerEl)
      .setName("Tracked properties")
      .setDesc("Comma-separated list of property keys to apply badges to (e.g. status,priority)")
      .addTextArea((text) => {
        text
          .setValue(this.plugin.settings.properties.join(", "))
          .onChange((value) => {
            this.plugin.settings.properties = value
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean);
          });
        text.inputEl.style.width = "100%";
        text.inputEl.rows = 2;
      });

    // ── Badge size ───────────────────────────────────────────
    new Setting(containerEl)
      .setName("Badge size (px)")
      .setDesc("Height in pixels. Width depends on the ratio setting below.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.badgeSize.toString())
          .onChange((value) => {
            this.plugin.settings.badgeSize = parseInt(value) || 20;
          })
      );

    // ── Keep ratio ──────────────────────────────────────────
    new Setting(containerEl)
      .setName("Keep image ratio")
      .setDesc("ON = preserve original aspect ratio. OFF = force square badge.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.keepRatio)
          .onChange((value) => {
            this.plugin.settings.keepRatio = value;
          })
      );

    // ── Storage location ─────────────────────────────────────
    containerEl.createEl("h3", { text: "Icon Storage" });

    new Setting(containerEl)
      .setName("Storage location")
      .setDesc(
        "Vault: icons are stored in the vault folder below (visible in file explorer). " +
        "Plugin: icons are stored inside the plugin folder (hidden from vault, survives vault moves)."
      )
      .addDropdown((drop) =>
        drop
          .addOption("vault", "Vault folder")
          .addOption("plugin", "Plugin folder")
          .setValue(this.plugin.settings.storageLocation)
          .onChange((value) => {
            this.plugin.settings.storageLocation = value;
            vaultFolderSetting.settingEl.style.display =
              value === "vault" ? "" : "none";
          })
      );

    const vaultFolderSetting = new Setting(containerEl)
      .setName("Vault icon folder")
      .setDesc("Path relative to vault root (only used when storage is set to Vault folder)")
      .addText((text) =>
        text
          .setPlaceholder("assets/icons")
          .setValue(this.plugin.settings.iconFolder)
          .onChange((value) => {
            this.plugin.settings.iconFolder = value || "assets/icons";
          })
      );

    // Hide vault folder field when plugin storage is selected
    if (this.plugin.settings.storageLocation === "plugin") {
      vaultFolderSetting.settingEl.style.display = "none";
    }

    // ── Mappings ─────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Badge Mappings" });

    this.plugin.settings.mappings.forEach((m, index) => {
      const setting = new Setting(containerEl).setName(`Mapping ${index + 1}`);

      setting.addText((text) =>
        text
          .setPlaceholder("Tag value (e.g. In Progress)")
          .setValue(m.text)
          .onChange((value) => {
            this.plugin.settings.mappings[index].text = value;
          })
      );

      // Preview image
      if (m.icon) {
        const url = this.plugin.getIconUrl(m.icon);
        if (url) {
          const img = document.createElement("img");
          img.src = url;
          img.style.height = "24px";
          img.style.width = this.plugin.settings.keepRatio ? "auto" : "24px";
          img.style.objectFit = "cover";
          img.style.marginLeft = "8px";
          img.style.borderRadius = "3px";
          img.style.verticalAlign = "middle";
          setting.controlEl.appendChild(img);
        }
      }

      // Upload button
      setting.addButton((btn) =>
        btn.setButtonText("📁 Upload icon").onClick(() => {
          this.uploadIcon(index);
        })
      );

      // Remove button
      setting.addButton((btn) =>
        btn
          .setButtonText("🗑️ Remove")
          .setWarning()
          .onClick(async () => {
            const mapping = this.plugin.settings.mappings[index];
            if (mapping.icon) {
              const deleted = this.plugin.deleteIconFile(mapping.icon);
              if (deleted) {
                new Notice(`🗑️ Deleted icon: ${mapping.icon}`);
              } else {
                new Notice(`⚠️ Icon file not found on disk, removing mapping only.`);
              }
            }
            this.plugin.settings.mappings.splice(index, 1);
            await this.plugin.saveSettings();
            this.display();
          })
      );
    });

    // ── Add mapping ──────────────────────────────────────────
    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("＋ Add mapping").onClick(() => {
        this.plugin.settings.mappings.push({ text: "", icon: "" });
        this.display();
      })
    );

    // ── Save ─────────────────────────────────────────────────
    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText("💾 Save all settings")
        .setCta()
        .onClick(async () => {
          await this.plugin.saveSettings();
        })
    );
  }

  async uploadIcon(index) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      const buffer = Buffer.from(await file.arrayBuffer());
      const iconDir = this.plugin.getIconFolderFsPath();

      if (!fs.existsSync(iconDir)) {
        fs.mkdirSync(iconDir, { recursive: true });
      }

      const filePath = path.join(iconDir, file.name);
      fs.writeFileSync(filePath, buffer);

      this.plugin.settings.mappings[index].icon = file.name;
      new Notice(`✅ Icon saved: ${file.name}`);
      this.display();
    };

    input.click();
  }
}