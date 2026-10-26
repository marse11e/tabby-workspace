import { Component, Input, OnChanges, OnDestroy, NgZone, ElementRef, ViewChild } from '@angular/core'
import { PanelStoreService } from '../panel-store.service'
import { ServerContext, ServerContextService, shellQuote } from '../server-context.service'

type SourceKind = 'unit' | 'container' | 'file'

interface LogSource {
    kind: SourceKind
    name: string
}

const FOLLOW_INTERVAL = 3000
const TAIL = 300
const ERROR_PATTERN = /error|fail|fatal|exception|panic|crit|denied|refused|traceback|\b5\d\d\b/i
const COMMON_FILES = [
    '/var/log/syslog', '/var/log/messages', '/var/log/auth.log',
    '/var/log/nginx/error.log', '/var/log/nginx/access.log',
    '/var/log/apache2/error.log', '/var/log/mysql/error.log',
]

@Component({
    selector: 'wp-logs',
    template: `
        <!-- Source picker -->
        <ng-container *ngIf="!source">
            <div class="wp-error" *ngIf="error">{{ error }}</div>
            <div class="wp-list list-group">
                <wp-group *ngFor="let group of groups" [key]="'logs.' + group.kind" [title]="group.title"
                          [icon]="group.icon" [count]="filtered(group.kind).length">
                    <div class="list-group-item wp-item clickable" *ngFor="let s of filtered(group.kind)" (click)="open(s)">
                        <i class="fas" [ngClass]="group.icon"></i>
                        <div class="wp-grow">
                            <div class="wp-name wp-mono">{{ s.name }}</div>
                            <div class="wp-desc">{{ group.hint }}</div>
                        </div>
                        <span class="wp-actions" *ngIf="s.kind === 'file' && isCustomFile(s.name)">
                            <button class="wp-icon-btn danger" ngbTooltip="Убрать из списка" container="body"
                                    (click)="$event.stopPropagation(); removeFile(s.name)"><i class="fas fa-times"></i></button>
                        </span>
                    </div>
                    <div class="wp-hint" *ngIf="!filtered(group.kind).length">Ничего не найдено</div>
                </wp-group>
            </div>
            <div class="wp-footer">
                <div class="input-group">
                    <span class="input-group-text"><i class="fas fa-fw fa-search"></i></span>
                    <input type="search" class="form-control" placeholder="Поиск сервиса, контейнера, файла" [(ngModel)]="query">
                    <button class="btn btn-secondary" ngbTooltip="Обновить" container="body" (click)="loadSources()">
                        <i class="fas fa-sync-alt" [class.fa-spin]="loadingSources"></i>
                    </button>
                </div>
                <div class="input-group">
                    <span class="input-group-text"><i class="fas fa-fw fa-file-medical"></i></span>
                    <input class="form-control wp-mono" placeholder="Свой файл: /var/www/app/logs/app.log" [(ngModel)]="newFile"
                           (keyup.enter)="addFile()">
                    <button class="btn btn-secondary" ngbTooltip="Добавить файл" container="body" [disabled]="!newFile.trim()" (click)="addFile()">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
            </div>
        </ng-container>

        <!-- Viewer -->
        <ng-container *ngIf="source">
            <div class="wp-top">
                <button class="wp-icon-btn" ngbTooltip="Назад" container="body" (click)="close()"><i class="fas fa-arrow-left"></i></button>
                <span class="wp-grow wp-name wp-mono">{{ source.name }}</span>
                <i class="fas fa-circle-notch fa-spin wp-muted" *ngIf="loadingLines"></i>
                <button class="wp-icon-btn" [class.active]="follow" container="body"
                        [ngbTooltip]="follow ? 'Автообновление включено' : 'Автообновление выключено'"
                        (click)="follow = !follow"><i class="fas" [ngClass]="follow ? 'fa-pause' : 'fa-play'"></i></button>
                <button class="wp-icon-btn" ngbTooltip="Следить в терминале" container="body" (click)="followInTerminal()"><i class="fas fa-terminal"></i></button>
            </div>
            <div class="wp-error" *ngIf="error">{{ error }}</div>
            <div class="wp-log" #logBox>
                <div *ngFor="let line of visibleLines()" class="wp-log-line" [class.err]="isError(line)">{{ line }}</div>
                <div class="wp-muted p-2" *ngIf="!visibleLines().length && !loadingLines">Нет строк</div>
            </div>
            <div class="wp-footer">
                <div class="input-group">
                    <span class="input-group-text"><i class="fas fa-fw fa-filter"></i></span>
                    <input type="search" class="form-control" placeholder="Фильтр строк" [(ngModel)]="lineFilter">
                    <button class="btn" [ngClass]="onlyErrors ? 'btn-danger' : 'btn-secondary'"
                            ngbTooltip="Только ошибки" container="body" (click)="onlyErrors = !onlyErrors">
                        <i class="fas fa-exclamation-circle"></i>
                    </button>
                </div>
            </div>
        </ng-container>
    `,
    styles: [`
        .wp-log {
            flex: 1;
            overflow: auto;
            margin: 8px;
            padding: 6px 8px;
            border-radius: 4px;
            background: rgba(0, 0, 0, 0.35);
            font-family: var(--terminal-font, monospace);
            font-size: 11px;
            line-height: 1.45;
        }
        .wp-log-line { white-space: pre-wrap; word-break: break-all; }
        .wp-log-line.err { color: var(--bs-danger); }
    `],
})
export class LogsSectionComponent implements OnChanges, OnDestroy {
    @Input() ctx: ServerContext
    @ViewChild('logBox') logBox?: ElementRef<HTMLElement>

    groups = [
        { kind: 'container' as SourceKind, title: 'Docker-контейнеры', icon: 'fa-cube', hint: 'docker logs' },
        { kind: 'unit' as SourceKind, title: 'Сервисы systemd', icon: 'fa-cogs', hint: 'journalctl' },
        { kind: 'file' as SourceKind, title: 'Файлы', icon: 'fa-file-alt', hint: 'tail' },
    ]

    sources: LogSource[] = []
    source: LogSource | null = null
    lines: string[] = []
    query = ''
    lineFilter = ''
    onlyErrors = false
    follow = true
    newFile = ''
    error: string | null = null
    loadingSources = false
    loadingLines = false

    // Outside Angular: a tick only re-renders when loadLines() brings new data
    private timer = this.zone.runOutsideAngular(() => setInterval(() => {
        if (this.source && this.follow && !document.hidden) {
            this.loadLines()
        }
    }, FOLLOW_INTERVAL))

    constructor (
        private contexts: ServerContextService,
        private store: PanelStoreService,
        private zone: NgZone,
    ) {}

    ngOnChanges (): void {
        this.source = null
        this.loadSources()
    }

    ngOnDestroy (): void {
        clearInterval(this.timer)
    }

    filtered (kind: SourceKind): LogSource[] {
        const q = this.query.trim().toLowerCase()
        return this.sources.filter(s => s.kind === kind && (!q || s.name.toLowerCase().includes(q)))
    }

    isCustomFile (path: string): boolean {
        return this.store.getLogFiles(this.ctx.key).includes(path)
    }

    async loadSources (): Promise<void> {
        this.loadingSources = true
        const ctx = this.ctx
        const files = [...new Set([...this.store.getLogFiles(ctx.key), ...COMMON_FILES])]
        const script = [
            'echo @@container; docker ps --format "{{.Names}}" 2>/dev/null',
            'echo @@unit; systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null | awk \'{print $1}\'',
            `echo @@file; for f in ${files.map(shellQuote).join(' ')}; do [ -r "$f" ] && echo "$f"; done`,
        ].join('\n')
        try {
            const { stdout } = await this.contexts.exec(ctx, script)
            const sources: LogSource[] = []
            let kind: SourceKind | null = null
            for (const line of stdout.split('\n').map(l => l.trim()).filter(Boolean)) {
                if (line.startsWith('@@')) {
                    kind = line.slice(2) as SourceKind
                } else if (kind) {
                    sources.push({ kind, name: line })
                }
            }
            // Custom files stay listed even if unreadable, so they can be removed
            for (const f of this.store.getLogFiles(ctx.key)) {
                if (!sources.some(s => s.kind === 'file' && s.name === f)) {
                    sources.push({ kind: 'file', name: f })
                }
            }
            if (ctx === this.ctx) {
                this.zone.run(() => {
                    this.sources = sources
                    this.error = null
                })
            }
        } catch (e) {
            this.zone.run(() => this.error = e.message)
        } finally {
            this.zone.run(() => this.loadingSources = false)
        }
    }

    addFile (): void {
        const path = this.newFile.trim()
        if (!path) {
            return
        }
        this.store.setLogFiles(this.ctx.key, [...new Set([...this.store.getLogFiles(this.ctx.key), path])])
        this.newFile = ''
        this.open({ kind: 'file', name: path })
        this.loadSources()
    }

    removeFile (path: string): void {
        this.store.setLogFiles(this.ctx.key, this.store.getLogFiles(this.ctx.key).filter(f => f !== path))
        this.sources = this.sources.filter(s => !(s.kind === 'file' && s.name === path))
    }

    open (source: LogSource): void {
        this.source = source
        this.lines = []
        this.lineFilter = ''
        this.error = null
        this.loadLines()
    }

    close (): void {
        this.source = null
        this.error = null
    }

    private command (source: LogSource, follow: boolean): string {
        const name = shellQuote(source.name)
        switch (source.kind) {
            case 'container': return `docker logs ${follow ? '-f ' : ''}--tail ${TAIL} ${name}${follow ? '' : ' 2>&1'}`
            case 'unit': return `journalctl -u ${name} -n ${TAIL} --no-pager${follow ? ' -f' : ''}`
            case 'file': return `tail -n ${TAIL}${follow ? ' -f' : ''} ${name}`
        }
    }

    async loadLines (): Promise<void> {
        const source = this.source
        if (!source || this.loadingLines) {
            return
        }
        this.loadingLines = true
        try {
            const { stdout, stderr } = await this.contexts.exec(this.ctx, this.command(source, false))
            if (source !== this.source) {
                return
            }
            const box = this.logBox?.nativeElement
            const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 40
            this.zone.run(() => {
                this.lines = stdout.split('\n').filter(l => l.length)
                this.error = !stdout.trim() && stderr.trim() ? stderr.trim() : null
            })
            if (atBottom) {
                setTimeout(() => box && (box.scrollTop = box.scrollHeight))
            }
        } catch (e) {
            this.zone.run(() => this.error = e.message)
        } finally {
            this.zone.run(() => this.loadingLines = false)
        }
    }

    isError (line: string): boolean {
        return ERROR_PATTERN.test(line)
    }

    visibleLines (): string[] {
        const q = this.lineFilter.trim().toLowerCase()
        return this.lines.filter(l => (!this.onlyErrors || this.isError(l)) && (!q || l.toLowerCase().includes(q)))
    }

    followInTerminal (): void {
        if (this.source) {
            this.contexts.sendToTerminal(this.ctx, this.command(this.source, true), true)
        }
    }
}
