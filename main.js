const { Plugin, PluginSettingTab, Setting, Notice } = require("obsidian");
const fs = require("fs");
const path = require("path");

const DEFAULT_SETTINGS = {
  properties: [],
  mappings: [],
  badgeSize: 20,
  iconFolder: "assets/icons"
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

  process(root) {
    const props = root.querySelectorAll('[data-property-key]');

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

        // tránh loop
        if (content.querySelector("img")) return;

        const filePath = `${this.settings.iconFolder}/${mapping.icon}`;
        const file = this.app.vault.getAbstractFileByPath(filePath);

        if (!file) {
          console.error("❌ File not found:", filePath);
          return;
        }

        const url = this.app.vault.getResourcePath(file);

        console.log("✅ LOAD:", url);

        const img = document.createElement("img");
        img.src = url;
        img.style.width = this.settings.badgeSize + "px";
        img.style.height = this.settings.badgeSize + "px";
        img.classList.add("badge-icon");
        img.setAttribute("data-name", text);

        img.onerror = () => {
          console.error("❌ Image failed:", url);
        };

        // 👉 replace hoàn toàn text
        content.innerHTML = "";
        content.appendChild(img);
      });
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    new Notice("Saved");
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

    new Setting(containerEl)
      .setName("Properties")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.properties.join(","))
      );

    new Setting(containerEl)
      .setName("Badge size")
      .addText((text) =>
        text.setValue(this.plugin.settings.badgeSize.toString())
      );

    new Setting(containerEl)
      .setName("Icon folder")
      .addText((text) =>
        text.setValue(this.plugin.settings.iconFolder)
      );

    this.plugin.settings.mappings.forEach((m, index) => {
      const setting = new Setting(containerEl).setName("Mapping");

      setting.addText((text) =>
        text.setValue(m.text).onChange((value) => {
          this.plugin.settings.mappings[index].text = value;
        })
      );

      if (m.icon) {
        const filePath = `${this.plugin.settings.iconFolder}/${m.icon}`;
        const file = this.app.vault.getAbstractFileByPath(filePath);

        if (file) {
          const img = document.createElement("img");
          img.src = this.app.vault.getResourcePath(file);
          img.style.width = "24px";
          img.style.height = "24px";
          img.style.marginLeft = "10px";
          setting.controlEl.appendChild(img);
        }
      }

      setting.addButton((btn) =>
        btn.setButtonText("Upload").onClick(() => {
          this.uploadIcon(index);
        })
      );
    });

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("Add mapping").onClick(() => {
        this.plugin.settings.mappings.push({ text: "", icon: "" });
        this.display();
      })
    );

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("💾 Save").setCta().onClick(async () => {
        const inputs = containerEl.querySelectorAll("textarea, input");

        this.plugin.settings.properties = inputs[0].value
          .split(",")
          .map((v) => v.trim());

        this.plugin.settings.badgeSize = parseInt(inputs[1].value) || 20;

        this.plugin.settings.iconFolder = inputs[2].value || "assets/icons";

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

      const basePath = this.app.vault.adapter.basePath;
      const iconDir = path.join(basePath, this.plugin.settings.iconFolder);

      if (!fs.existsSync(iconDir)) {
        fs.mkdirSync(iconDir, { recursive: true });
      }

      const filePath = path.join(iconDir, file.name);
      fs.writeFileSync(filePath, buffer);

      this.plugin.settings.mappings[index].icon = file.name;

      new Notice("Saved icon");

      this.display();
    };

    input.click();
  }
}