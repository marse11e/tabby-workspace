import { Component, Input, OnChanges } from '@angular/core'
import { PlatformService } from 'tabby-core'
import { PanelStoreService, Snippet } from '../panel-store.service'
import { ServerContext, ServerContextService } from '../server-context.service'

interface SnippetGroup {
    id: string
    title: string
    icon: string
    items: Snippet[]
}

const VARIABLE = /\{\{\s*([\w-]+)\s*\}\}/g

@Component({
    selector: 'wp-snippets',
    template: `
        <!-- Editor -->
        <div class="wp-form" *ngIf="editing">
            <input class="form-control" placeholder="Название" [(ngModel)]="editing.name">
            <textarea class="form-control" rows="4" placeholder="Команда, например: docker logs -f {{ '{{' }}container{{ '}}' }}"
                      [(ngModel)]="editing.command"></textarea>
            <select class="form-select" [(ngModel)]="editing.server">
                <option [ngValue]="null">Для всех серверов</option>
                <option [ngValue]="ctx.key">Только для {{ ctx.name }}</option>
            </select>
            <div class="wp-muted">Переменные: {{ '{{' }}имя{{ '}}' }} — значение спросим перед запуском</div>
            <div class="wp-form-buttons">
                <button class="btn btn-secondary btn-sm" (click)="editing = null">Отмена</button>
                <button class="btn btn-primary btn-sm" [disabled]="!editing.name.trim() || !editing.command.trim()" (click)="saveEditing()">Сохранить</button>
            </div>
        </div>

        <!-- Variables prompt -->
        <div class="wp-form" *ngIf="pending">
            <div class="wp-name">{{ pending.snippet.name }}</div>
            <div *ngFor="let name of pending.names">
                <label>{{ name }}</label>
                <input class="form-control" [(ngModel)]="pending.values[name]" (keyup.enter)="confirmPending()">
            </div>
            <div class="wp-form-buttons">
                <button class="btn btn-secondary btn-sm" (click)="pending = null">Отмена</button>
                <button class="btn btn-primary btn-sm" (click)="confirmPending()">{{ pending.run ? 'Выполнить' : 'Вставить' }}</button>
            </div>
        </div>

        <div class="wp-list list-group">
            <wp-group *ngFor="let group of groups(); trackBy: trackGroup" [key]="'snippets.' + group.id" [title]="group.title"
                      [icon]="group.icon" [count]="group.items.length">
                <div class="list-group-item wp-item clickable" *ngFor="let s of group.items; trackBy: trackSnippet"
                     (click)="use(s, false)" (dblclick)="use(s, true)">
                    <i class="fas fa-bolt"></i>
                    <div class="wp-grow">
                        <div class="wp-name">{{ s.name }}</div>
                        <div class="wp-desc wp-mono">{{ s.command }}</div>
                    </div>
                    <span class="wp-actions">
                        <button class="wp-icon-btn" ngbTooltip="Выполнить" container="body" (click)="$event.stopPropagation(); use(s, true)"><i class="fas fa-play"></i></button>
                        <button class="wp-icon-btn" ngbTooltip="Копировать" container="body" (click)="$event.stopPropagation(); copy(s)"><i class="fas fa-copy"></i></button>
                        <button class="wp-icon-btn" ngbTooltip="Изменить" container="body" (click)="$event.stopPropagation(); edit(s)"><i class="fas fa-pen"></i></button>
                        <button class="wp-icon-btn danger" ngbTooltip="Удалить" container="body" (click)="$event.stopPropagation(); remove(s)"><i class="fas fa-trash"></i></button>
                    </span>
                </div>
            </wp-group>

            <div class="wp-empty" *ngIf="!store.snippets.length && !editing">
                <i class="fas fa-bolt"></i>
                <p>Сохраняйте частые команды и запускайте их одним кликом</p>
                <button class="btn btn-primary btn-sm" (click)="addExamples()">Добавить примеры</button>
            </div>
            <div class="wp-hint" *ngIf="store.snippets.length">Клик — вставить в терминал, двойной клик — выполнить</div>
        </div>

        <div class="wp-footer">
            <div class="input-group">
                <span class="input-group-text"><i class="fas fa-fw fa-search"></i></span>
                <input type="search" class="form-control" placeholder="Поиск сниппета" [(ngModel)]="query">
                <button class="btn btn-secondary" ngbTooltip="Новый сниппет" container="body" (click)="startNew()">
                    <i class="fas fa-plus"></i>
                </button>
            </div>
        </div>
    `,
})
export class SnippetsSectionComponent implements OnChanges {
    @Input() ctx: ServerContext

    query = ''
    editing: Snippet | null = null
    pending: { snippet: Snippet, names: string[], values: Record<string, string>, run: boolean } | null = null

    constructor (
        public store: PanelStoreService,
        private contexts: ServerContextService,
        private platform: PlatformService,
    ) {}

    ngOnChanges (): void {
        this.pending = null
    }

    /** Cached so change detection keeps the same rows and their hover state */
    private groupsCache: { key: string, value: SnippetGroup[] } | null = null

    groups (): SnippetGroup[] {
        const snippets = this.store.snippets
        const key = `${this.ctx.key}\n${this.ctx.name}\n${this.query}`
        if (this.groupsCache?.key === key && this.groupsSource === snippets) {
            return this.groupsCache.value
        }
        this.groupsSource = snippets
        this.groupsCache = { key, value: this.buildGroups(snippets) }
        return this.groupsCache.value
    }

    trackGroup (_: number, group: SnippetGroup): string {
        return group.id
    }

    trackSnippet (_: number, s: Snippet): string {
        return s.id
    }

    private groupsSource: Snippet[] | null = null

    private buildGroups (snippets: Snippet[]): SnippetGroup[] {
        const q = this.query.trim().toLowerCase()
        const visible = snippets.filter(s =>
            (s.server === null || s.server === this.ctx.key)
            && (!q || s.name.toLowerCase().includes(q) || s.command.toLowerCase().includes(q)))
        const own = visible.filter(s => s.server !== null)
        const shared = visible.filter(s => s.server === null)
        return [
            { id: 'server', title: `Для ${this.ctx.name}`, icon: 'fa-server', items: own },
            { id: 'shared', title: 'Общие', icon: 'fa-globe', items: shared },
        ].filter(g => g.items.length)
    }

    startNew (): void {
        this.editing = { id: '', name: '', command: '', server: null }
    }

    edit (s: Snippet): void {
        this.editing = { ...s }
    }

    saveEditing (): void {
        const s = this.editing!
        this.store.saveSnippet({ ...s, id: s.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
        this.editing = null
    }

    async remove (s: Snippet): Promise<void> {
        const result = await this.platform.showMessageBox({
            type: 'warning',
            message: `Удалить сниппет «${s.name}»?`,
            buttons: ['Удалить', 'Отмена'],
            defaultId: 1,
            cancelId: 1,
        })
        if (result.response === 0) {
            this.store.deleteSnippet(s.id)
        }
    }

    copy (s: Snippet): void {
        this.platform.setClipboard({ text: s.command })
    }

    use (s: Snippet, run: boolean): void {
        const names = [...new Set([...s.command.matchAll(VARIABLE)].map(m => m[1]))]
        if (names.length) {
            this.pending = { snippet: s, names, values: {}, run }
            return
        }
        this.contexts.sendToTerminal(this.ctx, s.command, run)
    }

    confirmPending (): void {
        const { snippet, values, run } = this.pending!
        const command = snippet.command.replace(VARIABLE, (_, name) => values[name] ?? '')
        this.pending = null
        this.contexts.sendToTerminal(this.ctx, command, run)
    }

    addExamples (): void {
        const examples: [string, string][] = [
            ['Место на дисках', 'df -h'],
            ['Самые большие папки', 'du -h --max-depth=1 {{path}} 2>/dev/null | sort -rh | head -15'],
            ['Логи сервиса', 'journalctl -u {{service}} -n 100 -f'],
            ['Перезапустить сервис', 'systemctl restart {{service}} && systemctl status {{service}} --no-pager'],
            ['Docker: логи контейнера', 'docker logs -f --tail 200 {{container}}'],
            ['Docker compose: обновить', 'docker compose pull && docker compose up -d'],
            ['Кто слушает порт', 'ss -tlnp | grep :{{port}}'],
            ['Очистить Docker', 'docker system prune -f'],
        ]
        examples.forEach(([name, command], i) =>
            this.store.saveSnippet({ id: `example-${Date.now()}-${i}`, name, command, server: null }))
    }
}
