const {
    MarkdownView,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    debounce,
    setIcon,
} = require("obsidian");

const DEFAULT_SETTINGS = {
    enabledByDefault: true,
    scale: 0.1,
    minimapOpacity: 0.22,
    sliderOpacity: 0.32,
    topOffset: 0,
    width: 120,
    maxColumn: 120,
    renderCharacters: true,
};

class MinimapSettingTab extends PluginSettingTab {
    constructor(plugin) {
        super(plugin.app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Enable by default")
            .setDesc("Controls whether newly opened notes show the minimap.")
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.enabledByDefault)
                    .onChange(async (value) => {
                        this.plugin.settings.enabledByDefault = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Line scale")
            .setDesc("Height of each document line in the minimap.")
            .addSlider((slider) => {
                slider
                    .setLimits(0.05, 0.3, 0.01)
                    .setValue(this.plugin.settings.scale)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.scale = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Width")
            .setDesc("Minimap width in pixels.")
            .addSlider((slider) => {
                slider
                    .setLimits(72, 220, 1)
                    .setValue(this.plugin.settings.width)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.width = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Max column")
            .setDesc("Maximum characters rendered from each line.")
            .addSlider((slider) => {
                slider
                    .setLimits(40, 220, 1)
                    .setValue(this.plugin.settings.maxColumn)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.maxColumn = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Render characters")
            .setDesc("Disable this to render compact line blocks.")
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.renderCharacters)
                    .onChange(async (value) => {
                        this.plugin.settings.renderCharacters = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Opacity")
            .setDesc("Minimap background opacity.")
            .addSlider((slider) => {
                slider
                    .setLimits(0.05, 1, 0.01)
                    .setValue(this.plugin.settings.minimapOpacity)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.minimapOpacity = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Slider opacity")
            .setDesc("Viewport slider opacity.")
            .addSlider((slider) => {
                slider
                    .setLimits(0.05, 1, 0.01)
                    .setValue(this.plugin.settings.sliderOpacity)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.sliderOpacity = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Top offset")
            .setDesc("Offset from the top in pixels for custom toolbars.")
            .addSlider((slider) => {
                slider
                    .setLimits(0, 120, 1)
                    .setValue(this.plugin.settings.topOffset)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.topOffset = value;
                        await this.plugin.saveSettings();
                    });
            });
    }
}

class NoteMinimap extends Plugin {
    constructor(...args) {
        super(...args);
        this.instances = new Map();
        this.statusBarItemEl = null;
        this.statusBarToggleButton = null;
        this.refreshAll = debounce(() => this.syncLeaves(), 80, true);
        this.redrawAll = debounce(() => {
            for (const instance of this.instances.values()) {
                instance.requestRender();
            }
        }, 120, true);
    }

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new MinimapSettingTab(this));
        this.setupStatusBarToggle();

        this.registerEvent(
            this.app.workspace.on("layout-change", () => this.refreshAll())
        );
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", () => this.refreshAll())
        );
        this.registerEvent(
            this.app.workspace.on("file-open", () => this.refreshAll())
        );
        this.registerEvent(
            this.app.workspace.on("editor-change", (_editor, info) => {
                if (info instanceof MarkdownView) {
                    this.updateView(info);
                    return;
                }
                this.redrawAll();
            })
        );
        this.registerEvent(
            this.app.vault.on("modify", (file) => this.updateFile(file))
        );
        this.registerDomEvent(window, "focus", () => this.refreshAll());
        this.registerDomEvent(window, "blur", () => {
            for (const instance of this.instances.values()) {
                instance.cancelDrag();
            }
        });

        this.app.workspace.onLayoutReady(() => this.syncLeaves());
        console.log("NoteMinimap loaded");
    }

    onunload() {
        if (this.refreshAll?.cancel) this.refreshAll.cancel();
        if (this.redrawAll?.cancel) this.redrawAll.cancel();

        for (const instance of this.instances.values()) {
            instance.destroy();
        }
        this.instances.clear();

        document
            .querySelectorAll(".minimap-toggle-button")
            .forEach((button) => button.remove());
        this.statusBarItemEl?.remove();
        this.statusBarItemEl = null;
        this.statusBarToggleButton = null;
        document
            .querySelectorAll(".minimap-disabled")
            .forEach((el) => el.classList.remove("minimap-disabled"));

        console.log("NoteMinimap unloaded");
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        if ("betterRendering" in this.settings) {
            delete this.settings.betterRendering;
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
        for (const instance of this.instances.values()) {
            instance.updateSettings(this.settings);
        }
    }

    syncLeaves() {
        const leaves = this.app.workspace.getLeavesOfType("markdown");
        const openLeafIds = new Set();

        for (const leaf of leaves) {
            if (!(leaf.view instanceof MarkdownView)) continue;
            openLeafIds.add(leaf.id);
            this.addToggleButtonToLeaf(leaf);
            this.ensureLeaf(leaf);
            this.updateLeafToggleButton(leaf);
        }

        for (const [leafId, instance] of Array.from(this.instances.entries())) {
            if (!openLeafIds.has(leafId)) {
                instance.destroy();
                this.instances.delete(leafId);
            }
        }

        this.updateStatusBarToggle();
    }

    ensureLeaf(leaf) {
        const view = leaf.view;
        const contentEl = view?.contentEl;
        if (!contentEl || !(view instanceof MarkdownView)) return;

        if (!this.settings.enabledByDefault && !contentEl.dataset.minimapTouched) {
            contentEl.classList.add("minimap-disabled");
        }

        if (contentEl.classList.contains("minimap-disabled")) {
            const existing = this.instances.get(leaf.id);
            if (existing) {
                existing.destroy();
                this.instances.delete(leaf.id);
            }
            return;
        }

        const existing = this.instances.get(leaf.id);
        if (existing) {
            existing.updateLeaf(leaf);
            existing.requestRender();
            return;
        }

        this.instances.set(leaf.id, new MinimapInstance(this, leaf, this.settings));
    }

    updateView(view) {
        const leaf = this.app.workspace.getLeavesOfType("markdown").find((item) => {
            return item.view === view;
        });

        if (!leaf) {
            this.redrawAll();
            return;
        }

        this.addToggleButtonToLeaf(leaf);
        this.ensureLeaf(leaf);
        this.updateLeafToggleButton(leaf);
        this.updateStatusBarToggle();
        this.instances.get(leaf.id)?.requestRender();
    }

    updateFile(file) {
        for (const instance of this.instances.values()) {
            if (instance.view?.file?.path === file.path) {
                instance.requestRender();
            }
        }
    }

    addToggleButtonToLeaf(leaf) {
        const viewActions = leaf.view?.containerEl?.querySelector(".view-actions");
        const contentEl = leaf.view?.contentEl;
        if (!viewActions || !contentEl) return;
        if (viewActions.querySelector(".minimap-toggle-button")) return;

        const button = document.createElement("button");
        button.className = "clickable-icon minimap-toggle-button";
        button.setAttribute("aria-label", "Toggle minimap");
        button.setAttribute("aria-pressed", "false");
        setIcon(button, "panel-right");

        button.addEventListener("click", () => {
            this.toggleLeafMinimap(leaf, true);
        });

        viewActions.prepend(button);
        this.updateLeafToggleButton(leaf);
    }

    setupStatusBarToggle() {
        this.statusBarItemEl = this.addStatusBarItem();
        this.statusBarItemEl.classList.add("minimap-status-bar-item");

        const button = document.createElement("button");
        button.className = "clickable-icon minimap-status-toggle";
        button.type = "button";
        setIcon(button, "panel-right");
        this.statusBarItemEl.appendChild(button);
        this.statusBarToggleButton = button;

        this.registerDomEvent(button, "click", () => this.toggleActiveMinimap());
        this.updateStatusBarToggle();
    }

    getActiveMarkdownLeaf() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return null;

        return (
            this.app.workspace.getLeavesOfType("markdown").find((leaf) => {
                return leaf.view === activeView;
            }) || null
        );
    }

    toggleActiveMinimap() {
        const leaf = this.getActiveMarkdownLeaf();
        if (!leaf) {
            new Notice("Open a Markdown note to toggle the minimap.", 1200);
            this.updateStatusBarToggle();
            return;
        }

        this.toggleLeafMinimap(leaf, true);
    }

    toggleLeafMinimap(leaf, showNotice = false) {
        const contentEl = leaf?.view?.contentEl;
        if (!contentEl) return;

        contentEl.dataset.minimapTouched = "true";
        const disabled = contentEl.classList.toggle("minimap-disabled");
        this.ensureLeaf(leaf);
        this.updateLeafToggleButton(leaf);
        this.updateStatusBarToggle();

        if (showNotice && disabled) {
            new Notice("Note Minimap disabled for this pane.", 1200);
        }
    }

    updateLeafToggleButton(leaf) {
        const contentEl = leaf?.view?.contentEl;
        const button = leaf?.view?.containerEl?.querySelector(".minimap-toggle-button");
        if (!contentEl || !button) return;

        const enabled = !contentEl.classList.contains("minimap-disabled");
        button.classList.toggle("is-active", enabled);
        button.setAttribute("aria-pressed", enabled ? "true" : "false");
        button.setAttribute("aria-label", enabled ? "Hide minimap" : "Show minimap");
        button.setAttribute("title", enabled ? "Hide minimap" : "Show minimap");
    }

    updateStatusBarToggle() {
        if (!this.statusBarToggleButton) return;

        const leaf = this.getActiveMarkdownLeaf();
        const contentEl = leaf?.view?.contentEl;
        const hasMarkdownLeaf = Boolean(contentEl);
        const enabled =
            hasMarkdownLeaf && !contentEl.classList.contains("minimap-disabled");
        const label = !hasMarkdownLeaf
            ? "Minimap unavailable"
            : enabled
                ? "Hide minimap"
                : "Show minimap";

        this.statusBarToggleButton.disabled = !hasMarkdownLeaf;
        this.statusBarToggleButton.classList.toggle("is-active", enabled);
        this.statusBarToggleButton.setAttribute(
            "aria-pressed",
            enabled ? "true" : "false"
        );
        this.statusBarToggleButton.setAttribute("aria-label", label);
        this.statusBarToggleButton.setAttribute("title", label);
    }
}

class MinimapInstance {
    constructor(plugin, leaf, settings) {
        this.plugin = plugin;
        this.leaf = leaf;
        this.view = leaf.view;
        this.contentEl = this.view.contentEl;
        this.settings = Object.assign({}, settings);
        this.destroyed = false;
        this.dragging = false;
        this.renderRequest = 0;

        this.onScroll = this.onScroll.bind(this);
        this.onPointerDown = this.onPointerDown.bind(this);
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);
        this.onResize = this.onResize.bind(this);
        this.requestRender = this.requestRender.bind(this);

        this.setupElements();
        this.resizeObserver = new ResizeObserver(this.onResize);
        this.resizeObserver.observe(this.contentEl);
        this.bindScroller();
        this.updateSettings(settings);
        this.requestRender();
    }

    updateLeaf(leaf) {
        const nextContentEl = leaf.view.contentEl;
        if (nextContentEl !== this.contentEl) {
            this.destroy();
            this.plugin.instances.set(
                leaf.id,
                new MinimapInstance(this.plugin, leaf, this.plugin.settings)
            );
            return;
        }

        this.leaf = leaf;
        this.view = leaf.view;
        this.bindScroller();
    }

    updateSettings(settings) {
        this.settings = Object.assign({}, settings);
        this.contentEl.style.setProperty(
            "--minimap-width",
            `${this.settings.width}px`
        );
        this.container.style.width = `${this.settings.width}px`;
        this.container.style.top = `${this.settings.topOffset}px`;
        this.container.style.setProperty(
            "--minimap-background",
            alphaColor(getCssColor(this.contentEl, "--background-primary", "rgb(30, 30, 30)"), this.settings.minimapOpacity)
        );
        this.slider.style.opacity = this.settings.sliderOpacity;
        this.requestRender();
        this.updateSlider();
    }

    setupElements() {
        this.contentEl
            .querySelectorAll(".minimap-container")
            .forEach((el) => el.remove());

        this.contentEl.classList.add("minimap-host");

        this.container = document.createElement("div");
        this.container.className = "minimap-container";
        this.container.setAttribute("aria-hidden", "true");
        this.container.setAttribute("role", "presentation");

        this.canvas = document.createElement("canvas");
        this.canvas.className = "minimap-canvas";
        this.container.appendChild(this.canvas);

        this.slider = document.createElement("div");
        this.slider.className = "minimap-slider";
        this.container.appendChild(this.slider);

        this.contentEl.prepend(this.container);

        this.container.addEventListener("pointerdown", this.onPointerDown);
        this.container.addEventListener("pointermove", this.onPointerMove);
        this.container.addEventListener("pointerup", this.onPointerUp);
        this.container.addEventListener("pointercancel", this.onPointerUp);
        this.container.addEventListener("lostpointercapture", this.onPointerUp);
    }

    bindScroller() {
        const nextScroller = this.findScroller();
        if (this.scroller === nextScroller) return;

        if (this.scroller) {
            this.scroller.removeEventListener("scroll", this.onScroll);
        }

        this.scroller = nextScroller;

        if (this.scroller) {
            this.scroller.addEventListener("scroll", this.onScroll, {
                passive: true,
            });
        }

        this.updateSlider();
    }

    findScroller() {
        return (
            this.contentEl.querySelector(".cm-scroller") ||
            this.contentEl.querySelector(".markdown-preview-view") ||
            this.contentEl.querySelector(".markdown-reading-view")
        );
    }

    onResize() {
        if (this.destroyed) return;
        this.bindScroller();
        this.requestRender();
        this.updateSlider();
    }

    onScroll() {
        if (this.destroyed) return;
        this.requestRender();
        this.updateSlider();
    }

    requestRender() {
        if (this.destroyed || this.renderRequest) return;

        this.renderRequest = requestAnimationFrame(() => {
            this.renderRequest = 0;
            this.render();
        });
    }

    async render() {
        if (this.destroyed) return;

        const rect = this.container.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        const ratio = window.devicePixelRatio || 1;

        this.canvas.width = Math.max(1, Math.floor(width * ratio));
        this.canvas.height = Math.max(1, Math.floor(height * ratio));
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        const ctx = this.canvas.getContext("2d");
        if (!ctx) return;

        ctx.scale(ratio, ratio);
        ctx.clearRect(0, 0, width, height);

        const background = alphaColor(
            getCssColor(this.contentEl, "--background-primary", "rgb(30, 30, 30)"),
            this.settings.minimapOpacity
        );
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);

        const text = await this.getText();
        if (this.destroyed) return;

        const lines = this.getVisualLines(text);
        const metrics = this.getScrollMetrics();
        const lineHeight = this.getMiniLineHeight();
        const minimapContentHeight = Math.max(height, lines.length * lineHeight);
        const maxMinimapScroll = Math.max(0, minimapContentHeight - height);
        const minimapScroll =
            metrics.maxScroll === 0
                ? 0
                : (metrics.scrollTop / metrics.maxScroll) * maxMinimapScroll;
        const firstVisibleLine = clamp(
            Math.floor(minimapScroll / lineHeight),
            0,
            Math.max(0, lines.length - 1)
        );
        const yOffset = -(minimapScroll % lineHeight);
        const linesToPaint = Math.ceil((height - yOffset) / lineHeight) + 2;
        const textColor = getCssColor(this.contentEl, "--text-muted", "rgb(145, 145, 145)");
        const headingColor = getCssColor(this.contentEl, "--text-normal", "rgb(190, 190, 190)");
        const linkColor = getCssColor(this.contentEl, "--link-color", textColor);

        ctx.textBaseline = "top";
        ctx.font = `${Math.max(2, lineHeight)}px monospace`;

        let y = yOffset;
        for (
            let index = firstVisibleLine;
            index < lines.length && index < firstVisibleLine + linesToPaint;
            index++
        ) {
            const line = lines[index] || "";
            this.paintLine(ctx, line, 0, y, width, lineHeight, {
                textColor,
                headingColor,
                linkColor,
            });
            y += lineHeight;
        }

        this.updateSlider();
    }

    paintLine(ctx, line, x, y, width, lineHeight, colors) {
        const trimmed = line.trimStart();
        const indent = Math.min(28, Math.max(0, line.length - trimmed.length) * 0.7);
        const maxColumn = Math.max(1, this.settings.maxColumn || DEFAULT_SETTINGS.maxColumn);
        const clipped = trimmed.slice(0, maxColumn);
        const visualWidth = Math.min(
            width - indent,
            Math.max(2, (clipped.length / maxColumn) * (width - 6))
        );

        if (!clipped) {
            ctx.fillStyle = alphaColor(colors.textColor, 0.18);
            ctx.fillRect(x + indent, y + Math.max(0, lineHeight - 1), Math.min(12, width), 1);
            return;
        }

        if (trimmed.startsWith("#")) {
            ctx.fillStyle = alphaColor(colors.headingColor, 0.78);
        } else if (/\[[^\]]+\]\([^)]+\)|https?:\/\//.test(trimmed)) {
            ctx.fillStyle = alphaColor(colors.linkColor, 0.5);
        } else {
            ctx.fillStyle = alphaColor(colors.textColor, 0.56);
        }

        if (!this.settings.renderCharacters || lineHeight < 3) {
            ctx.fillRect(x + indent, y + Math.max(0, Math.floor(lineHeight / 2) - 1), visualWidth, Math.max(1, Math.floor(lineHeight / 2)));
            return;
        }

        const text = clipped.replace(/\t/g, "    ");
        ctx.fillText(text, x + indent, y, width - indent);
    }

    getVisualLines(text) {
        const maxColumn = Math.max(1, this.settings.maxColumn || DEFAULT_SETTINGS.maxColumn);
        const result = [];

        for (const rawLine of text.split(/\r\n|\r|\n/)) {
            const line = rawLine || "";
            if (line.length <= maxColumn) {
                result.push(line);
                continue;
            }

            const indent = line.match(/^\s*/)?.[0] || "";
            let remaining = line.trimEnd();

            while (remaining.length > maxColumn) {
                let splitAt = remaining.lastIndexOf(" ", maxColumn);
                if (splitAt < Math.floor(maxColumn * 0.45)) {
                    splitAt = maxColumn;
                }

                result.push(remaining.slice(0, splitAt));
                remaining = `${indent}${remaining.slice(splitAt).trimStart()}`;
            }

            result.push(remaining || indent);
        }

        return result.length ? result : [""];
    }

    async getText() {
        try {
            if (this.view?.editor?.getValue) {
                return this.view.editor.getValue();
            }

            const file = this.view?.file;
            if (file?.path) {
                return await this.plugin.app.vault.cachedRead(file);
            }
        } catch (error) {
            console.warn("NoteMinimap: failed to read note text", error);
        }

        return "";
    }

    getMiniLineHeight() {
        return clamp(Math.round(this.getEditorLineHeight() * this.getScale()), 3, 9);
    }

    getEditorLineHeight() {
        const scroller = this.scroller || this.findScroller();
        const computed = scroller ? getComputedStyle(scroller) : null;
        const editorLineHeight = computed ? Number.parseFloat(computed.lineHeight) : 20;
        return Number.isFinite(editorLineHeight) && editorLineHeight > 0
            ? editorLineHeight
            : 20;
    }

    getScale() {
        return clamp(Number(this.settings.scale) || DEFAULT_SETTINGS.scale, 0.05, 0.3);
    }

    getTrackRect() {
        const rect = this.container.getBoundingClientRect();
        const topOffset = this.settings.topOffset || 0;
        return {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: Math.max(1, rect.height),
            bottom: rect.bottom,
            topOffset,
        };
    }

    getScrollMetrics() {
        this.bindScroller();

        if (!this.scroller) {
            return {
                scrollTop: 0,
                scrollHeight: 1,
                clientHeight: 1,
                maxScroll: 0,
            };
        }

        const scrollHeight = Math.max(1, this.scroller.scrollHeight);
        const clientHeight = Math.max(1, this.scroller.clientHeight);
        const maxScroll = Math.max(0, scrollHeight - clientHeight);

        return {
            scrollTop: clamp(this.scroller.scrollTop, 0, maxScroll),
            scrollHeight,
            clientHeight,
            maxScroll,
        };
    }

    updateSlider() {
        if (this.destroyed || !this.slider) return;

        const track = this.getTrackRect();
        const metrics = this.getScrollMetrics();
        const sliderHeight = clamp(
            (metrics.clientHeight / metrics.scrollHeight) * track.height,
            24,
            track.height
        );
        const maxSliderTop = Math.max(0, track.height - sliderHeight);
        const sliderTop =
            metrics.maxScroll === 0
                ? 0
                : (metrics.scrollTop / metrics.maxScroll) * maxSliderTop;

        this.slider.style.height = `${sliderHeight}px`;
        this.slider.style.transform = `translateY(${sliderTop}px)`;
        this.slider.style.display = metrics.maxScroll > 0 ? "block" : "none";
    }

    onPointerDown(event) {
        if (this.destroyed || event.button !== 0) return;

        this.bindScroller();
        if (!this.scroller) return;

        event.preventDefault();
        event.stopPropagation();

        const sliderRect = this.slider.getBoundingClientRect();
        const isOnSlider =
            event.clientY >= sliderRect.top && event.clientY <= sliderRect.bottom;
        this.dragOffset = isOnSlider
            ? event.clientY - sliderRect.top
            : sliderRect.height / 2;

        this.dragging = true;
        this.slider.classList.add("dragging");
        this.container.setPointerCapture?.(event.pointerId);
        this.scrollToPointer(event.clientY);
    }

    onPointerMove(event) {
        if (!this.dragging) return;
        event.preventDefault();
        this.scrollToPointer(event.clientY);
    }

    onPointerUp(event) {
        if (!this.dragging) return;

        this.cancelDrag();
        if (event?.pointerId !== undefined) {
            this.container.releasePointerCapture?.(event.pointerId);
        }
    }

    cancelDrag() {
        this.dragging = false;
        this.dragOffset = 0;
        this.slider?.classList.remove("dragging");
    }

    scrollToPointer(clientY) {
        const track = this.getTrackRect();
        const metrics = this.getScrollMetrics();
        const sliderHeight = clamp(
            (metrics.clientHeight / metrics.scrollHeight) * track.height,
            24,
            track.height
        );
        const maxSliderTop = Math.max(0, track.height - sliderHeight);
        const offset = clamp(clientY - track.top - this.dragOffset, 0, maxSliderTop);
        const nextScroll =
            maxSliderTop === 0 ? 0 : (offset / maxSliderTop) * metrics.maxScroll;

        this.scroller.scrollTop = nextScroll;
        this.updateSlider();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;

        if (this.renderRequest) {
            cancelAnimationFrame(this.renderRequest);
            this.renderRequest = 0;
        }

        if (this.scroller) {
            this.scroller.removeEventListener("scroll", this.onScroll);
            this.scroller = null;
        }

        this.resizeObserver?.disconnect();
        this.container?.removeEventListener("pointerdown", this.onPointerDown);
        this.container?.removeEventListener("pointermove", this.onPointerMove);
        this.container?.removeEventListener("pointerup", this.onPointerUp);
        this.container?.removeEventListener("pointercancel", this.onPointerUp);
        this.container?.removeEventListener("lostpointercapture", this.onPointerUp);
        this.container?.remove();
        this.contentEl?.style.removeProperty("--minimap-width");
        this.contentEl?.classList.remove("minimap-host");
    }
}

module.exports = {
    default: NoteMinimap,
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getCssColor(element, variableName, fallback) {
    const value = getComputedStyle(element).getPropertyValue(variableName).trim();
    return value || fallback;
}

function alphaColor(color, alpha) {
    if (!color) return `rgba(0, 0, 0, ${alpha})`;
    const trimmed = color.trim();

    if (trimmed.startsWith("#")) {
        let hex = trimmed.slice(1);
        if (hex.length === 3) {
            hex = hex
                .split("")
                .map((part) => part + part)
                .join("");
        }

        if (hex.length >= 6) {
            const value = Number.parseInt(hex.slice(0, 6), 16);
            const r = (value >> 16) & 255;
            const g = (value >> 8) & 255;
            const b = value & 255;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
    }

    const match = trimmed.match(/rgba?\(([^)]+)\)/);
    if (match) {
        const parts = match[1]
            .split(",")
            .map((part) => part.trim())
            .slice(0, 3);
        if (parts.length === 3) {
            return `rgba(${parts.join(", ")}, ${alpha})`;
        }
    }

    return trimmed;
}
