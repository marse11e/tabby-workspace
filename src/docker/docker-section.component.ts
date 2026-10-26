import { Component, Input, OnInit, OnDestroy, NgZone, HostListener } from '@angular/core'
import { AppService, ConfigService, PlatformService } from 'tabby-core'
import { Subscription } from 'rxjs'
import { debounceTime } from 'rxjs/operators'
import { DockerService, DockerHost, DockerContainer } from './docker.service'

const REFRESH_INTERVAL = 10000
const ROOT_KEY = '__root__'

interface HostState {
    host: DockerHost
    containers: DockerContainer[]
    error: string | null
    loading: boolean
    busy: Set<string>
}

/**
 * "Docker" group shown inside the SSH sidebar: containers of this machine and
 * of the SSH hosts the user added, with a right-click menu for common actions.
 */
@Component({
    selector: 'docker-section',
    template: `
        <div class="list-group-item list-group-item-action d-flex align-items-center group-header"
             (click)="toggle(rootKey)">
            <i class="fa fa-fw" [ngClass]="isCollapsed(rootKey) ? 'fa-chevron-right' : 'fa-chevron-down'"></i>
            <i class="fab fa-fw fa-docker ms-1"></i>
            <span class="ms-2 me-auto">Docker</span>
            <span class="badge bg-success me-1" *ngIf="runningTotal()" title="Запущено">{{ runningTotal() }}</span>
            <span class="badge bg-secondary">{{ containerTotal() }}</span>
        </div>

        <ng-container *ngIf="!isCollapsed(rootKey)">
            <ng-container *ngFor="let state of states">
                <div class="list-group-item list-group-item-action d-flex align-items-center host-header"
                     (click)="toggle(state.host.id)"
                     (contextmenu)="openHostMenu($event, state)">
                    <i class="fa fa-fw" [ngClass]="isCollapsed(state.host.id) ? 'fa-chevron-right' : 'fa-chevron-down'"></i>
                    <i class="fas fa-fw ms-1" [ngClass]="state.host.profile ? 'fa-server' : 'fa-laptop'"></i>
                    <span class="ms-2 me-auto text-truncate">{{ state.host.name }}</span>
                    <i class="fas fa-fw fa-circle-notch fa-spin text-muted" *ngIf="state.loading"></i>
                    <button class="btn btn-link btn-sm hover-reveal" title="Обновить"
                            (click)="$event.stopPropagation(); refresh(state)">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>

                <ng-container *ngIf="!isCollapsed(state.host.id)">
                    <div class="docker-message text-danger" *ngIf="state.error">
                        <i class="fas fa-exclamation-triangle me-1"></i>{{ state.error }}
                    </div>
                    <div class="docker-message text-muted"
                         *ngIf="!state.error && !state.loading && state.containers.length === 0">
                        Нет контейнеров
                    </div>
                    <ng-container *ngFor="let c of state.containers">
                        <div class="list-group-item container-item d-flex align-items-center"
                             *ngIf="matches(c)"
                             [class.stopped]="c.state !== 'running'"
                             [title]="c.image + ' — ' + c.status"
                             (dblclick)="openShell(state, c)"
                             (contextmenu)="openMenu($event, state, c)">
                            <span class="status-dot" [ngClass]="'state-' + c.state"></span>
                            <div class="container-info">
                                <div class="container-name">{{ c.name }}</div>
                                <div class="container-desc text-muted">
                                    {{ c.image }}<span *ngIf="c.ports.length"> · :{{ c.ports.join(', :') }}</span>
                                </div>
                            </div>
                            <div class="me-auto"></div>
                            <i class="fas fa-circle-notch fa-spin text-muted" *ngIf="state.busy.has(c.id)"></i>
                            <ng-container *ngIf="!state.busy.has(c.id)">
                                <button class="btn btn-link btn-sm hover-reveal" *ngIf="c.state !== 'running'"
                                        title="Запустить" (click)="$event.stopPropagation(); action(state, c, 'start')">
                                    <i class="fas fa-play"></i>
                                </button>
                                <button class="btn btn-link btn-sm hover-reveal" *ngIf="c.state === 'running'"
                                        title="Перезапустить" (click)="$event.stopPropagation(); action(state, c, 'restart')">
                                    <i class="fas fa-redo"></i>
                                </button>
                            </ng-container>
                        </div>
                    </ng-container>
                </ng-container>
            </ng-container>
        </ng-container>

        <div class="context-menu" *ngIf="menu" [style.left.px]="menu.x" [style.top.px]="menu.y"
             (click)="$event.stopPropagation()">
            <ng-container *ngIf="menu.container as c">
                <div class="context-menu-title text-truncate">{{ c.name }}</div>
                <div class="context-menu-item" *ngIf="c.state !== 'running' && c.state !== 'paused'"
                     (click)="action(menu.state, c, 'start')">
                    <i class="fas fa-fw fa-play"></i><span>Запустить</span>
                </div>
                <div class="context-menu-item" *ngIf="c.state === 'running'" (click)="action(menu.state, c, 'stop')">
                    <i class="fas fa-fw fa-stop"></i><span>Остановить</span>
                </div>
                <div class="context-menu-item" *ngIf="c.state === 'running' || c.state === 'paused'"
                     (click)="action(menu.state, c, 'restart')">
                    <i class="fas fa-fw fa-redo"></i><span>Перезапустить</span>
                </div>
                <div class="context-menu-item" *ngIf="c.state === 'running'" (click)="action(menu.state, c, 'pause')">
                    <i class="fas fa-fw fa-pause"></i><span>Приостановить</span>
                </div>
                <div class="context-menu-item" *ngIf="c.state === 'paused'" (click)="action(menu.state, c, 'unpause')">
                    <i class="fas fa-fw fa-play-circle"></i><span>Продолжить</span>
                </div>
                <div class="context-menu-divider"></div>
                <div class="context-menu-item" *ngIf="c.state === 'running'" (click)="openShell(menu.state, c)">
                    <i class="fas fa-fw fa-terminal"></i><span>Открыть терминал</span>
                </div>
                <div class="context-menu-item" (click)="openLogs(menu.state, c)">
                    <i class="fas fa-fw fa-file-alt"></i><span>Логи</span>
                </div>
                <div class="context-menu-item" *ngIf="c.state === 'running'" (click)="openStats(menu.state, c)">
                    <i class="fas fa-fw fa-chart-line"></i><span>Нагрузка (stats)</span>
                </div>
                <div class="context-menu-item" *ngFor="let port of c.ports" (click)="openPort(menu.state, port)">
                    <i class="fas fa-fw fa-globe"></i><span>Открыть в браузере :{{ port }}</span>
                </div>
                <ng-container *ngIf="c.project">
                    <div class="context-menu-divider"></div>
                    <div class="context-menu-item" (click)="projectAction(menu.state, c.project, 'restart')">
                        <i class="fas fa-fw fa-layer-group"></i><span>Перезапустить проект {{ c.project }}</span>
                    </div>
                    <div class="context-menu-item" (click)="projectAction(menu.state, c.project, 'stop')">
                        <i class="fas fa-fw fa-layer-group"></i><span>Остановить проект {{ c.project }}</span>
                    </div>
                </ng-container>
                <div class="context-menu-divider"></div>
                <div class="context-menu-item" (click)="copy(c.name)">
                    <i class="fas fa-fw fa-copy"></i><span>Копировать имя</span>
                </div>
                <div class="context-menu-item" (click)="copy(c.id)">
                    <i class="fas fa-fw fa-fingerprint"></i><span>Копировать ID</span>
                </div>
                <div class="context-menu-divider"></div>
                <div class="context-menu-item context-menu-item-danger" (click)="remove(menu.state, c)">
                    <i class="fas fa-fw fa-trash-alt"></i><span>Удалить контейнер</span>
                </div>
            </ng-container>
            <ng-container *ngIf="!menu.container">
                <div class="context-menu-item" (click)="refresh(menu.state); closeMenu()">
                    <i class="fas fa-fw fa-sync-alt"></i><span>Обновить</span>
                </div>
                <div class="context-menu-item" (click)="openTab(menu.state, 'docker ps', ['ps', '-a'])">
                    <i class="fas fa-fw fa-terminal"></i><span>docker ps в терминале</span>
                </div>
                <div class="context-menu-item" (click)="pruneStopped(menu.state)">
                    <i class="fas fa-fw fa-broom"></i><span>Удалить остановленные</span>
                </div>
                <ng-container *ngIf="menu.state.host.profile && docker.isRemoteHost(menu.state.host.id)">
                    <div class="context-menu-divider"></div>
                    <div class="context-menu-item context-menu-item-danger" (click)="removeHost(menu.state)">
                        <i class="fas fa-fw fa-times"></i><span>Убрать сервер из Docker</span>
                    </div>
                </ng-container>
            </ng-container>
        </div>
    `,
    styles: [`
        :host { display: contents; }

        .host-header {
            padding-left: 22px;
            font-size: 12px;
            opacity: 0.85;
        }

        .container-item {
            padding: 6px 12px 6px 34px;
            gap: 8px;
            cursor: default;
            background: rgba(10, 12, 19, 0.6);
        }

        .container-item.stopped .container-name { opacity: 0.55; }

        .container-info { min-width: 0; }

        .container-name, .container-desc {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .container-name { font-size: 13px; }
        .container-desc { font-size: 11px; }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            flex-shrink: 0;
            background: var(--bs-secondary);
        }
        .state-running { background: var(--bs-success); box-shadow: 0 0 6px var(--bs-success); }
        .state-paused { background: var(--bs-warning); }
        .state-restarting { background: var(--bs-info); }
        .state-dead, .state-exited { background: var(--bs-danger); opacity: 0.7; }

        .docker-message {
            padding: 6px 12px 6px 34px;
            font-size: 11px;
        }

        .hover-reveal { opacity: 0; transition: opacity 0.2s ease; padding: 0 4px; }
        .container-item:hover .hover-reveal, .host-header:hover .hover-reveal { opacity: 1; }

        .btn-link { color: var(--bs-body-color); text-decoration: none; }
        .btn-link:hover { color: var(--bs-primary); }

        .badge { font-size: 9px; padding: 2px 6px; }

        .context-menu {
            position: fixed;
            background: var(--bs-body-bg);
            border: 1px solid var(--bs-border-color);
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            min-width: 220px;
            max-width: 320px;
            padding: 4px 0;
            font-size: 13px;
        }
        .context-menu-title {
            padding: 6px 16px;
            font-size: 11px;
            opacity: 0.6;
        }
        .context-menu-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 7px 16px;
            cursor: pointer;
            color: var(--bs-body-color);
        }
        .context-menu-item:hover { background: var(--bs-tertiary-bg); }
        .context-menu-item-danger { color: var(--bs-danger); }
        .context-menu-item-danger:hover { background: var(--bs-danger); color: white; }
        .context-menu-item i { width: 14px; text-align: center; }
        .context-menu-divider { height: 1px; background: var(--bs-border-color); margin: 4px 0; }
    `],
})
export class DockerSectionComponent implements OnInit, OnDestroy {
    @Input() filter = ''

    rootKey = ROOT_KEY
    states: HostState[] = []
    menu: { x: number, y: number, state: HostState, container: DockerContainer | null } | null = null

    private timer: any = null
    private configSub: Subscription | null = null
    private tabsSub: Subscription | null = null

    constructor(
        public docker: DockerService,
        private config: ConfigService,
        private platform: PlatformService,
        private app: AppService,
        private zone: NgZone,
    ) {}

    async ngOnInit(): Promise<void> {
        await this.loadHosts()
        this.configSub = this.config.changed$.pipe(debounceTime(300)).subscribe(() => this.loadHosts())
        this.tabsSub = this.app.tabsChanged$.pipe(debounceTime(500)).subscribe(() => this.loadHosts())
        this.timer = setInterval(async () => {
            // SSH tabs finish connecting after they open, so recheck hosts too
            await this.loadHosts()
            if (!document.hidden && !this.isCollapsed(ROOT_KEY)) {
                this.refreshExpanded()
            }
        }, REFRESH_INTERVAL)
    }

    ngOnDestroy(): void {
        clearInterval(this.timer)
        this.configSub?.unsubscribe()
        this.tabsSub?.unsubscribe()
    }

    @HostListener('document:click')
    closeMenu(): void {
        this.menu = null
    }

    private async loadHosts(): Promise<void> {
        const hosts = await this.docker.getHosts()
        const signature = (list: DockerHost[]) => list.map(h => `${h.id}:${!!h.session}`).join()
        if (signature(hosts) === signature(this.states.map(s => s.host))) {
            return
        }
        const previous = new Map(this.states.map(s => [s.host.id, s]))
        this.zone.run(() => {
            this.states = hosts.map(host => {
                const state = previous.get(host.id)
                if (state) {
                    state.host = host
                    return state
                }
                return { host, containers: [], error: null, loading: false, busy: new Set<string>() }
            })
        })
        this.refreshExpanded()
    }

    private refreshExpanded(): void {
        if (this.isCollapsed(ROOT_KEY)) {
            return
        }
        for (const state of this.states) {
            if (!this.isCollapsed(state.host.id)) {
                this.refresh(state)
            }
        }
    }

    async refresh(state: HostState): Promise<void> {
        if (state.loading) {
            return
        }
        state.loading = true
        try {
            const containers = await this.docker.listContainers(state.host)
            this.zone.run(() => {
                state.containers = containers
                state.error = null
            })
        } catch (e) {
            this.zone.run(() => {
                state.containers = []
                state.error = e.message
            })
        } finally {
            this.zone.run(() => state.loading = false)
        }
    }

    isCollapsed(key: string): boolean {
        // Servers without an open tab start collapsed so we don't ssh into every server on startup
        const stored = (this.config.store.pluginConfig?.['ssh-sidebar']?.dockerCollapsed || {})[key]
        if (stored !== undefined) {
            return stored
        }
        const state = this.states.find(s => s.host.id === key)
        return !!state?.host.profile && !state.host.session
    }

    toggle(key: string): void {
        const collapsed = !this.isCollapsed(key)
        this.docker.setCollapsed(key, collapsed)
        if (!collapsed) {
            this.refreshExpanded()
        }
    }

    matches(c: DockerContainer): boolean {
        const q = this.filter.trim().toLowerCase()
        return !q || c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q)
    }

    containerTotal(): number {
        return this.states.reduce((n, s) => n + s.containers.length, 0)
    }

    runningTotal(): number {
        return this.states.reduce((n, s) => n + s.containers.filter(c => c.state === 'running').length, 0)
    }

    openMenu(event: MouseEvent, state: HostState, container: DockerContainer): void {
        event.preventDefault()
        event.stopPropagation()
        this.menu = { ...this.menuPosition(event), state, container }
    }

    openHostMenu(event: MouseEvent, state: HostState): void {
        event.preventDefault()
        event.stopPropagation()
        this.menu = { ...this.menuPosition(event), state, container: null }
    }

    private menuPosition(event: MouseEvent): { x: number, y: number } {
        // Keep the menu on screen near the bottom of the window
        return { x: event.clientX, y: Math.min(event.clientY, window.innerHeight - 460) }
    }

    async action(state: HostState, c: DockerContainer, verb: string): Promise<void> {
        this.closeMenu()
        await this.runBusy(state, [c.id], () => this.docker.run(state.host, [verb, c.id]))
    }

    async projectAction(state: HostState, project: string, verb: string): Promise<void> {
        this.closeMenu()
        const ids = state.containers.filter(c => c.project === project).map(c => c.id)
        await this.runBusy(state, ids, () => this.docker.run(state.host, [verb, ...ids]))
    }

    async remove(state: HostState, c: DockerContainer): Promise<void> {
        this.closeMenu()
        const result = await this.platform.showMessageBox({
            type: 'warning',
            message: `Удалить контейнер ${c.name}?`,
            detail: c.state === 'running' ? 'Контейнер запущен и будет остановлен.' : undefined,
            buttons: ['Удалить', 'Отмена'],
            defaultId: 1,
            cancelId: 1,
        })
        if (result.response === 0) {
            await this.runBusy(state, [c.id], () => this.docker.run(state.host, ['rm', '-f', c.id]))
        }
    }

    async pruneStopped(state: HostState): Promise<void> {
        this.closeMenu()
        const stopped = state.containers.filter(c => c.state === 'exited' || c.state === 'dead' || c.state === 'created')
        if (!stopped.length) {
            return
        }
        const result = await this.platform.showMessageBox({
            type: 'warning',
            message: `Удалить остановленные контейнеры (${stopped.length}) на «${state.host.name}»?`,
            detail: stopped.map(c => c.name).join(', '),
            buttons: ['Удалить', 'Отмена'],
            defaultId: 1,
            cancelId: 1,
        })
        if (result.response === 0) {
            const ids = stopped.map(c => c.id)
            await this.runBusy(state, ids, () => this.docker.run(state.host, ['rm', ...ids]))
        }
    }

    removeHost(state: HostState): void {
        this.closeMenu()
        if (state.host.profile) {
            this.docker.toggleRemoteHost(state.host.id)
        }
    }

    openShell(state: HostState, c: DockerContainer): void {
        if (c.state !== 'running') {
            return
        }
        this.openTab(state, `🐳 ${c.name}`, ['exec', '-it', c.id, 'sh', '-c', 'command -v bash >/dev/null && exec bash || exec sh'])
    }

    openLogs(state: HostState, c: DockerContainer): void {
        this.openTab(state, `📜 ${c.name}`, ['logs', '-f', '--tail', '300', c.id])
    }

    openStats(state: HostState, c: DockerContainer): void {
        this.openTab(state, `📈 ${c.name}`, ['stats', c.id])
    }

    openTab(state: HostState, title: string, args: string[]): void {
        this.closeMenu()
        this.docker.openTab(state.host, title, args)
    }

    openPort(state: HostState, port: number): void {
        this.closeMenu()
        this.platform.openExternal(`http://${this.docker.hostAddress(state.host)}:${port}`)
    }

    copy(text: string): void {
        this.closeMenu()
        this.platform.setClipboard({ text })
    }

    private async runBusy(state: HostState, ids: string[], fn: () => Promise<void>): Promise<void> {
        ids.forEach(id => state.busy.add(id))
        try {
            await fn()
        } catch (e) {
            this.platform.showMessageBox({
                type: 'error',
                message: `Docker: ${state.host.name}`,
                detail: e.message,
                buttons: ['OK'],
            })
        } finally {
            this.zone.run(() => ids.forEach(id => state.busy.delete(id)))
            await this.refresh(state)
        }
    }
}
