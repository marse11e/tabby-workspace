import { Component } from "@angular/core";
import { ConfigService } from "tabby-core";
import { ElectronHostWindow, ElectronService } from "tabby-electron";
import * as path from "path";
import { BackgroundService } from "./background.service";
import { BackgroundExtrasService } from "./extras.service";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"];

@Component({
  template: `
    <div class="alert alert-warning d-flex align-items-center" *ngIf="!base.backgroundEnabled">
      <span class="me-auto">Фон выключен — возможности ниже заработают, когда он включён.</span>
      <button class="btn btn-sm btn-warning" (click)="enableBackground()">Включить фон</button>
    </div>

    <!-- Quick image -->
    <h4>Быстрая смена картинки</h4>
    <div class="drop-zone mb-4" [class.over]="dragOver"
         (dragover)="$event.preventDefault(); dragOver = true" (dragleave)="dragOver = false" (drop)="onDrop($event)"
         (click)="pickBaseImage()">
      <img *ngIf="base.backgroundPath" [src]="fileUrl(base.backgroundPath)" class="drop-preview" alt="">
      <div>
        <div><i class="fas fa-image me-2"></i><b>Перетащите картинку сюда</b> или нажмите, чтобы выбрать</div>
        <div class="text-muted small">Картинка скопируется в ~/.config/tabby/backgrounds и станет фоном (простой режим)</div>
      </div>
    </div>

    <!-- Per server -->
    <h4>Фон для серверов</h4>
    <div class="text-muted small mb-2">
      Свой фон и цветная рамка для отдельных серверов. Например, красная рамка с надписью PROD, чтобы случайно не перепутать продакшн.
      Правила проверяются сверху вниз; совпадение ищется в имени профиля и адресе, <code>*</code> — любые символы.
    </div>
    <div class="list-group mb-2">
      <div class="list-group-item rule" *ngFor="let rule of s.rules; let i = index" [class.active-rule]="extras.activeRule === rule">
        <div class="d-flex align-items-center gap-2">
          <div class="form-check form-switch m-0">
            <input class="form-check-input" type="checkbox" [(ngModel)]="rule.enabled" (ngModelChange)="save()">
          </div>
          <input class="form-control form-control-sm" style="max-width: 200px" placeholder="prod*, 31.58.*, Kiri"
                 [(ngModel)]="rule.match" (ngModelChange)="save()">
          <input class="form-control form-control-sm" style="max-width: 110px" placeholder="Надпись" [(ngModel)]="rule.label" (ngModelChange)="save()">
          <input type="color" class="form-control form-control-color form-control-sm" title="Цвет рамки"
                 [ngModel]="rule.frameColor || '#ff3b30'" (ngModelChange)="rule.frameColor = $event; save()">
          <button class="btn btn-sm btn-link" *ngIf="rule.frameColor" title="Без рамки" (click)="rule.frameColor = ''; save()">
            <i class="fas fa-ban"></i>
          </button>
          <span class="badge bg-success" *ngIf="extras.activeRule === rule">сейчас активно</span>
          <span class="ms-auto"></span>
          <button class="btn btn-sm btn-outline-danger" (click)="removeRule(i)"><i class="fas fa-trash"></i></button>
        </div>
        <div class="d-flex align-items-center gap-2 mt-2">
          <img *ngIf="rule.image" [src]="fileUrl(rule.image)" class="thumb" alt="">
          <input class="form-control form-control-sm" placeholder="Картинка (пусто — общий фон)" [(ngModel)]="rule.image" (ngModelChange)="save()">
          <button class="btn btn-sm btn-secondary" (click)="pickInto(rule, 'image')"><i class="fas fa-folder-open"></i></button>
        </div>
      </div>
      <div class="list-group-item text-muted text-center" *ngIf="!s.rules.length">Правил пока нет</div>
    </div>
    <div class="d-flex gap-2 mb-4">
      <button class="btn btn-sm btn-primary" (click)="addRule('')"><i class="fas fa-plus me-1"></i>Добавить правило</button>
      <button class="btn btn-sm btn-secondary" (click)="addRule('prod*', 'PROD', '#ff3b30')">Пример: продакшн</button>
    </div>

    <!-- Schedule -->
    <h4>День и ночь</h4>
    <div class="form-line">
      <div class="header">
        <div class="title">Менять фон по времени суток</div>
        <div class="description">Светлая картинка днём, тёмная вечером</div>
      </div>
      <toggle [(ngModel)]="s.scheduleEnabled" (ngModelChange)="save()"></toggle>
    </div>
    <ng-container *ngIf="s.scheduleEnabled">
      <div class="form-line">
        <div class="header">
          <div class="title"><i class="fas fa-sun me-1"></i>Днём, с {{ s.dayStartHour }}:00</div>
        </div>
        <input type="number" min="0" max="23" class="form-control hour" [(ngModel)]="s.dayStartHour" (ngModelChange)="save()">
        <input class="form-control ms-2" placeholder="Картинка" [(ngModel)]="s.dayImage" (ngModelChange)="save()">
        <button class="btn btn-secondary ms-2" (click)="pickInto(s, 'dayImage')"><i class="fas fa-folder-open"></i></button>
      </div>
      <div class="form-line">
        <div class="header">
          <div class="title"><i class="fas fa-moon me-1"></i>Ночью, с {{ s.nightStartHour }}:00</div>
        </div>
        <input type="number" min="0" max="23" class="form-control hour" [(ngModel)]="s.nightStartHour" (ngModelChange)="save()">
        <input class="form-control ms-2" placeholder="Картинка" [(ngModel)]="s.nightImage" (ngModelChange)="save()">
        <button class="btn btn-secondary ms-2" (click)="pickInto(s, 'nightImage')"><i class="fas fa-folder-open"></i></button>
      </div>
    </ng-container>

    <!-- Bing -->
    <h4 class="mt-4">Картинка дня</h4>
    <div class="form-line">
      <div class="header">
        <div class="title">Картинка дня Bing</div>
        <div class="description">Каждый день новый красивый фон. Скачивается раз в день, хранятся последние 7</div>
      </div>
      <toggle [(ngModel)]="s.bingEnabled" (ngModelChange)="save(); s.bingEnabled && !s.bingImage && extras.refreshBing()"></toggle>
    </div>
    <div class="d-flex align-items-center gap-3 mb-4" *ngIf="s.bingEnabled">
      <img *ngIf="s.bingImage" [src]="fileUrl(s.bingImage)" class="bing-preview" alt="">
      <div>
        <div class="small">{{ s.bingTitle }}</div>
        <div class="text-danger small" *ngIf="extras.bingError">{{ extras.bingError }}</div>
        <button class="btn btn-sm btn-secondary mt-2" [disabled]="extras.bingLoading" (click)="extras.refreshBing()">
          <i class="fas fa-sync-alt me-1" [class.fa-spin]="extras.bingLoading"></i>Обновить сейчас
        </button>
      </div>
    </div>
    <div class="text-muted small mb-4">Приоритет: фон сервера → день/ночь → картинка дня → обычный фон.</div>

    <!-- Comfort -->
    <h4>Удобство</h4>
    <div class="form-line">
      <div class="header">
        <div class="title">Приглушать фон, когда окно не в фокусе</div>
        <div class="description">Картинка тускнеет, пока вы в другом окне</div>
      </div>
      <toggle [(ngModel)]="s.dimUnfocused" (ngModelChange)="save()"></toggle>
    </div>
    <div class="form-line" *ngIf="s.dimUnfocused">
      <div class="header">
        <div class="title">Насколько приглушать: {{ s.dimUnfocusedAmount }}%</div>
      </div>
      <input type="range" class="form-range" style="width: 200px" min="10" max="100" step="5"
             [(ngModel)]="s.dimUnfocusedAmount" (ngModelChange)="save()">
    </div>
    <div class="form-line">
      <div class="header">
        <div class="title">Горячие клавиши</div>
        <div class="description">«Фон: следующая картинка» и «Фон: включить / выключить» — назначьте в Настройки → Горячие клавиши</div>
      </div>
      <button class="btn btn-secondary" (click)="background.nextBackground()" [disabled]="base.backgroundMode !== 'advanced'"
              title="Работает в расширенном режиме со слайд-шоу">
        <i class="fas fa-forward me-1"></i>Следующая картинка
      </button>
    </div>
  `,
  styles: [
    `
      h4 { margin-top: 8px; }
      .drop-zone {
        display: flex; align-items: center; gap: 16px;
        padding: 16px; border: 2px dashed var(--bs-border-color); border-radius: 8px;
        cursor: pointer; transition: border-color 0.2s, background 0.2s;
      }
      .drop-zone:hover, .drop-zone.over { border-color: var(--bs-primary); background: rgba(0, 141, 248, 0.08); }
      .drop-preview { width: 120px; height: 68px; object-fit: cover; border-radius: 4px; }
      .bing-preview { width: 200px; height: 112px; object-fit: cover; border-radius: 6px; }
      .thumb { width: 54px; height: 30px; object-fit: cover; border-radius: 3px; }
      .rule.active-rule { border-left: 3px solid var(--bs-success); }
      .hour { width: 70px; }
    `,
  ],
})
export class BackgroundExtrasSettingsComponent {
  dragOver = false;

  constructor(
    public extras: BackgroundExtrasService,
    public background: BackgroundService,
    private config: ConfigService,
    private electron: ElectronService,
    private hostWindow: ElectronHostWindow,
  ) {}

  get s() {
    return this.extras.settings;
  }

  get base(): any {
    return this.config.store.backgroundPlugin;
  }

  save(): void {
    this.extras.save();
  }

  fileUrl(file: string): string {
    return "file://" + encodeURI(file.replaceAll("\\", "/"));
  }

  enableBackground(): void {
    this.base.backgroundEnabled = true;
    this.background.apply();
  }

  addRule(match: string, label = "", frameColor = ""): void {
    this.s.rules.push({ id: `${Date.now()}`, enabled: true, match, label, frameColor, image: "" });
    this.save();
  }

  removeRule(i: number): void {
    this.s.rules.splice(i, 1);
    this.save();
  }

  private pickImage(): string | null {
    const paths = this.electron.dialog.showOpenDialogSync(this.hostWindow.getWindow(), {
      filters: [{ name: "Изображения", extensions: IMAGE_EXTENSIONS.map((e) => e.slice(1)) }],
      properties: ["openFile"],
    });
    return paths?.[0] ?? null;
  }

  pickInto(target: any, key: string): void {
    const file = this.pickImage();
    if (file) {
      target[key] = file;
      this.save();
    }
  }

  pickBaseImage(): void {
    const file = this.pickImage();
    if (file) {
      this.setBaseImage(file);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = false;
    const file = Array.from(event.dataTransfer?.files || []).find((f) => IMAGE_EXTENSIONS.includes(path.extname(f.name).toLowerCase()));
    const filePath = (file as any)?.path;
    if (filePath) {
      this.setBaseImage(filePath);
    }
  }

  private setBaseImage(file: string): void {
    this.base.backgroundPath = this.extras.importImage(file);
    this.base.backgroundMode = "simple";
    this.base.backgroundEnabled = true;
    this.background.apply();
  }
}

