import { Injectable, NgZone } from "@angular/core";
import { ConfigService, HotkeysService } from "tabby-core";
import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import { Subscription } from "rxjs";
import { ServerContext, ServerContextService } from "../workspace-panel/server-context.service";
import { BackgroundService } from "./background.service";

export interface ServerBackgroundRule {
  id: string;
  enabled: boolean;
  /** Matched against the profile name and host, "*" works as a wildcard */
  match: string;
  image: string;
  /** Frame around the terminal, e.g. red for production */
  frameColor: string;
  label: string;
}

export interface BackgroundExtrasConfig {
  rules: ServerBackgroundRule[];
  scheduleEnabled: boolean;
  dayImage: string;
  nightImage: string;
  dayStartHour: number;
  nightStartHour: number;
  bingEnabled: boolean;
  bingImage: string;
  bingTitle: string;
  bingDate: string;
  dimUnfocused: boolean;
  dimUnfocusedAmount: number;
}

const DEFAULTS: BackgroundExtrasConfig = {
  rules: [],
  scheduleEnabled: false,
  dayImage: "",
  nightImage: "",
  dayStartHour: 8,
  nightStartHour: 20,
  bingEnabled: false,
  bingImage: "",
  bingTitle: "",
  bingDate: "",
  dimUnfocused: false,
  dimUnfocusedAmount: 50,
};

export const BACKGROUNDS_DIR = path.join(os.homedir(), ".config", "tabby", "backgrounds");
const CHECK_INTERVAL = 60 * 1000;
const BING_URL = "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=ru-RU";

/**
 * Additions on top of the background plugin: per-server backgrounds and
 * frames, day/night schedule, Bing picture of the day, dimming when the
 * window loses focus and hotkeys. They override only the image of the
 * existing background layer, so filters and opacity settings still apply.
 */
@Injectable({ providedIn: "root" })
export class BackgroundExtrasService {
  /** Rule matched by the active tab, for the settings page */
  activeRule: ServerBackgroundRule | null = null;
  bingLoading = false;
  bingError: string | null = null;

  private style: HTMLStyleElement;
  private dimStyle: HTMLStyleElement;
  private ctx: ServerContext | null = null;
  private ctxSub: Subscription | null = null;

  constructor(
    private config: ConfigService,
    private background: BackgroundService,
    private contexts: ServerContextService,
    private zone: NgZone,
    hotkeys: HotkeysService,
  ) {
    this.style = document.createElement("style");
    this.style.id = "workspace-background-extras";
    document.body.appendChild(this.style);
    this.dimStyle = document.createElement("style");
    this.dimStyle.id = "workspace-background-dim";
    document.body.appendChild(this.dimStyle);

    this.config.ready$.subscribe(() => {
      this.watchContextIfNeeded();
      this.refreshBingIfNeeded();
      this.update();
    });
    this.config.changed$.subscribe(() => {
      this.watchContextIfNeeded();
      this.update();
    });
    setInterval(() => {
      this.refreshBingIfNeeded();
      this.update();
    }, CHECK_INTERVAL);

    window.addEventListener("blur", () => this.setDimmed(true));
    window.addEventListener("focus", () => this.setDimmed(false));

    hotkeys.hotkey$.subscribe((hotkey) => {
      if (hotkey === "background-next") {
        this.background.nextBackground();
      } else if (hotkey === "background-toggle") {
        this.background.toggleBackground();
      }
    });
  }

  get settings(): BackgroundExtrasConfig {
    const root = (this.config.store.pluginConfig ??= {});
    const current = root["workspace-background"];
    if (!current || Object.keys(DEFAULTS).some((key) => !(key in current))) {
      root["workspace-background"] = { ...DEFAULTS, ...(current || {}) };
    }
    return root["workspace-background"];
  }

  save(): void {
    this.config.save();
    this.update();
  }

  /** Only follow tabs when there are rules, so nothing runs otherwise */
  private watchContextIfNeeded(): void {
    const needed = this.settings.rules.some((r) => r.enabled);
    if (needed && !this.ctxSub) {
      this.ctxSub = this.contexts.context$.subscribe((ctx) => {
        this.ctx = ctx;
        this.update();
      });
    } else if (!needed && this.ctxSub) {
      this.ctxSub.unsubscribe();
      this.ctxSub = null;
      this.ctx = null;
    }
  }

  matchRule(rule: ServerBackgroundRule, ctx: ServerContext | null): boolean {
    if (!ctx || !rule.match.trim()) {
      return false;
    }
    const pattern = new RegExp(
      rule.match
        .trim()
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*"),
      "i",
    );
    return pattern.test(ctx.name) || pattern.test(ctx.address);
  }

  private currentImage(rule: ServerBackgroundRule | null): string | null {
    const s = this.settings;
    if (rule?.image) {
      return rule.image;
    }
    if (s.scheduleEnabled) {
      const hour = new Date().getHours();
      const { dayStartHour: day, nightStartHour: night } = s;
      const isDay = day < night ? hour >= day && hour < night : hour >= day || hour < night;
      const image = isDay ? s.dayImage : s.nightImage;
      if (image) {
        return image;
      }
    }
    if (s.bingEnabled && s.bingImage && fs.existsSync(s.bingImage)) {
      return s.bingImage;
    }
    return null;
  }

  update(): void {
    const s = this.settings;
    const rule = s.rules.find((r) => r.enabled && this.matchRule(r, this.ctx)) ?? null;
    this.activeRule = rule;
    const image = this.currentImage(rule);
    let css = "/* added by tabby-workspace */\n";
    if (image) {
      css += `.content-tab-active::before { background-image: url("${encodeURI(image.replaceAll("\\", "/"))}") !important; }\n`;
    }
    if (rule?.frameColor) {
      css += `.content-tab-active { outline: 2px solid ${rule.frameColor}; outline-offset: -2px; }\n`;
      if (rule.label) {
        const label = rule.label.replace(/["\\]/g, "");
        css += `.content-tab-active { --workspace-server-label: "${label}"; }\n`;
        css += `.content-tab-active::after { content: var(--workspace-server-label) !important; color: #fff; font: 600 11px sans-serif;
          display: flex !important; align-items: flex-start; justify-content: flex-end; padding: 6px 10px; box-sizing: border-box;
          text-shadow: 0 0 4px ${rule.frameColor}; }\n`;
      }
    }
    if (this.style.textContent !== css) {
      this.style.textContent = css;
    }
    if (!s.dimUnfocused) {
      this.dimStyle.textContent = "";
    }
  }

  private setDimmed(dimmed: boolean): void {
    const s = this.settings;
    this.dimStyle.textContent =
      dimmed && s.dimUnfocused
        ? `.content-tab-active::before { opacity: ${(100 - s.dimUnfocusedAmount) / 100} !important; transition: opacity 0.4s; }`
        : "";
  }

  private refreshBingIfNeeded(): void {
    const s = this.settings;
    const today = new Date().toISOString().slice(0, 10);
    if (s.bingEnabled && (s.bingDate !== today || !fs.existsSync(s.bingImage)) && !this.bingLoading) {
      this.refreshBing();
    }
  }

  async refreshBing(): Promise<void> {
    this.bingLoading = true;
    this.bingError = null;
    try {
      const info = JSON.parse((await download(BING_URL)).toString("utf8"));
      const image = info.images?.[0];
      if (!image?.url) {
        throw new Error("Bing не вернул картинку");
      }
      const url = "https://www.bing.com" + String(image.url).replace(/_\d+x\d+\./, "_UHD.");
      const date = new Date().toISOString().slice(0, 10);
      const dir = path.join(BACKGROUNDS_DIR, "bing");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${date}.jpg`);
      fs.writeFileSync(file, await download(url));
      // Keep the last week only
      for (const old of fs.readdirSync(dir).sort().slice(0, -7)) {
        fs.rmSync(path.join(dir, old), { force: true });
      }
      this.zone.run(() => {
        Object.assign(this.settings, { bingImage: file, bingDate: date, bingTitle: image.copyright || image.title || "" });
        this.save();
      });
    } catch (e) {
      this.zone.run(() => (this.bingError = e.message));
    } finally {
      this.zone.run(() => (this.bingLoading = false));
    }
  }

  /** Copies an image into Tabby's backgrounds folder and returns the new path */
  importImage(source: string): string {
    fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true });
    const target = path.join(BACKGROUNDS_DIR, `${Date.now()}-${path.basename(source)}`);
    fs.copyFileSync(source, target);
    return target;
  }
}

function download(url: string, redirects = 3): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 20000 }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          resolve(download(new URL(res.headers.location, url).toString(), redirects - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Bing ответил ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("timeout", function () {
        this.destroy(new Error("Bing не ответил"));
      })
      .on("error", reject);
  });
}
