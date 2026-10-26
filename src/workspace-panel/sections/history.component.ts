import { Component, Input, OnChanges, NgZone } from '@angular/core'
import { PlatformService } from 'tabby-core'
import { PanelStoreService } from '../panel-store.service'
import { ServerContext, ServerContextService } from '../server-context.service'

const LIMIT = 1000

// Reads the shells' own history files: bash, zsh (incl. extended format) and fish
const HISTORY_SCRIPT = `
for f in ~/.bash_history ~/.zsh_history; do [ -r "$f" ] && tail -n ${LIMIT} "$f"; done
f=~/.local/share/fish/fish_history; [ -r "$f" ] && grep '^- cmd: ' "$f" | tail -n ${LIMIT} | sed 's/^- cmd: //'
true
`

@Component({
    selector: 'wp-history',
    template: `
        <div class="wp-error" *ngIf="error">{{ error }}</div>
        <div class="wp-list list-group">
            <wp-group key="history.list" [title]="'История ' + ctx.name" icon="fa-history" [count]="visible().length">
                <div class="list-group-item wp-item clickable" *ngFor="let cmd of visible()"
                     (click)="use(cmd, false)" (dblclick)="use(cmd, true)">
                    <i class="fas fa-angle-right"></i>
                    <div class="wp-grow wp-name wp-mono">{{ cmd }}</div>
                    <span class="wp-actions">
                        <button class="wp-icon-btn" ngbTooltip="Выполнить" container="body" (click)="$event.stopPropagation(); use(cmd, true)"><i class="fas fa-play"></i></button>
                        <button class="wp-icon-btn" ngbTooltip="Сохранить как сниппет" container="body" (click)="$event.stopPropagation(); saveSnippet(cmd)"><i class="fas fa-bolt"></i></button>
                        <button class="wp-icon-btn" ngbTooltip="Копировать" container="body" (click)="$event.stopPropagation(); copy(cmd)"><i class="fas fa-copy"></i></button>
                    </span>
                </div>
                <div class="wp-hint" *ngIf="!loading && !commands.length && !error">История пуста</div>
            </wp-group>
            <div class="wp-hint" *ngIf="commands.length">Клик — вставить в терминал, двойной клик — выполнить</div>
        </div>

        <div class="wp-footer">
            <div class="input-group">
                <span class="input-group-text"><i class="fas fa-fw fa-search"></i></span>
                <input type="search" class="form-control" placeholder="Поиск по истории" [(ngModel)]="query">
                <button class="btn btn-secondary" ngbTooltip="Обновить" container="body" (click)="load()">
                    <i class="fas fa-sync-alt" [class.fa-spin]="loading"></i>
                </button>
            </div>
        </div>
    `,
})
export class HistorySectionComponent implements OnChanges {
    @Input() ctx: ServerContext

    commands: string[] = []
    query = ''
    loading = false
    error: string | null = null

    constructor (
        private contexts: ServerContextService,
        private store: PanelStoreService,
        private platform: PlatformService,
        private zone: NgZone,
    ) {}

    ngOnChanges (): void {
        this.commands = []
        this.load()
    }

    async load (): Promise<void> {
        this.loading = true
        const ctx = this.ctx
        try {
            const { stdout } = await this.contexts.exec(ctx, HISTORY_SCRIPT)
            // Newest first, each command once
            const seen = new Set<string>()
            const commands: string[] = []
            const lines = stdout.split('\n')
                .map(l => l.replace(/^: \d+:\d+;/, '').replace(/\\n/g, '\n').trim())
                .filter(l => l && !l.startsWith('#'))
            for (let i = lines.length - 1; i >= 0; i--) {
                if (!seen.has(lines[i])) {
                    seen.add(lines[i])
                    commands.push(lines[i])
                }
            }
            if (ctx === this.ctx) {
                this.zone.run(() => {
                    this.commands = commands
                    this.error = null
                })
            }
        } catch (e) {
            this.zone.run(() => this.error = e.message)
        } finally {
            this.zone.run(() => this.loading = false)
        }
    }

    visible (): string[] {
        const q = this.query.trim().toLowerCase()
        return (q ? this.commands.filter(c => c.toLowerCase().includes(q)) : this.commands).slice(0, 300)
    }

    use (cmd: string, run: boolean): void {
        this.contexts.sendToTerminal(this.ctx, cmd, run)
    }

    copy (cmd: string): void {
        this.platform.setClipboard({ text: cmd })
    }

    saveSnippet (cmd: string): void {
        this.store.saveSnippet({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: cmd.length > 40 ? cmd.slice(0, 40) + '…' : cmd,
            command: cmd,
            server: this.ctx.key,
        })
    }
}
