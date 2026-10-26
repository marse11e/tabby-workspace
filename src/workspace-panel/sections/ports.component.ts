import { Component, Input, OnChanges, NgZone } from '@angular/core'
import { PlatformService } from 'tabby-core'
import { ServerContext, ServerContextService } from '../server-context.service'
import { Tunnel, TunnelService } from '../tunnel.service'

interface ListeningPort {
    port: number
    address: string
    process: string
}

const LOOPBACK = ['127.0.0.1', '::1', 'localhost']

@Component({
    selector: 'wp-ports',
    template: `
        <div class="wp-error" *ngIf="error">{{ error }}</div>
        <div class="wp-list list-group">
            <wp-group *ngIf="ctx.kind === 'ssh'" key="ports.tunnels" title="Туннели на этот компьютер"
                      icon="fa-exchange-alt" [count]="tunnelsHere().length">
                <div class="list-group-item wp-item ok" *ngFor="let t of tunnelsHere()">
                    <i class="fas fa-exchange-alt text-success"></i>
                    <div class="wp-grow">
                        <div class="wp-name wp-mono">localhost:{{ t.localPort }}</div>
                        <div class="wp-desc">→ {{ t.remoteHost }}:{{ t.remotePort }} на сервере<span *ngIf="t.connections"> · {{ t.connections }} подкл.</span></div>
                    </div>
                    <span class="wp-actions always">
                        <button class="wp-icon-btn" ngbTooltip="Открыть в браузере" container="body" (click)="browse('localhost', t.localPort)"><i class="fas fa-globe"></i></button>
                        <button class="wp-icon-btn" ngbTooltip="Копировать адрес" container="body" (click)="copy('localhost:' + t.localPort)"><i class="fas fa-copy"></i></button>
                        <button class="wp-icon-btn danger" ngbTooltip="Закрыть туннель" container="body" (click)="tunnels.close(t.id)"><i class="fas fa-times"></i></button>
                    </span>
                </div>
                <div class="wp-hint" *ngIf="!tunnelsHere().length">
                    Нажмите <i class="fas fa-exchange-alt"></i> у порта ниже или введите порт внизу — он откроется у вас на localhost
                </div>
            </wp-group>

            <wp-group key="ports.listening" [title]="ctx.kind === 'ssh' ? 'Открытые порты на сервере' : 'Открытые порты'"
                      icon="fa-plug" [count]="ports.length">
                <div class="list-group-item wp-item" *ngFor="let p of ports">
                    <i class="fas" [ngClass]="isLoopback(p) ? 'fa-lock' : 'fa-globe'"></i>
                    <div class="wp-grow">
                        <div class="wp-name"><span class="wp-mono">{{ p.port }}</span> · {{ p.process || 'неизвестно' }}</div>
                        <div class="wp-desc">{{ isLoopback(p) ? 'Только локально' : 'Доступен снаружи' }} · {{ p.address }}</div>
                    </div>
                    <span class="wp-actions">
                        <button class="wp-icon-btn" *ngIf="ctx.kind === 'ssh' && !hasTunnel(p)" ngbTooltip="Пробросить на этот компьютер"
                                container="body" (click)="forward(p)"><i class="fas fa-exchange-alt"></i></button>
                        <button class="wp-icon-btn" *ngIf="ctx.kind === 'local' || !isLoopback(p)" ngbTooltip="Открыть в браузере"
                                container="body" (click)="browse(ctx.address, p.port)"><i class="fas fa-globe"></i></button>
                    </span>
                </div>
            </wp-group>
        </div>

        <div class="wp-footer">
            <div class="input-group" *ngIf="ctx.kind === 'ssh'">
                <span class="input-group-text"><i class="fas fa-fw fa-exchange-alt"></i></span>
                <input class="form-control wp-mono" placeholder="Порт сервера: 5432 или 10.0.0.5:3306" [(ngModel)]="customTarget"
                       (keyup.enter)="openCustom()">
                <button class="btn btn-secondary" ngbTooltip="Пробросить" container="body" [disabled]="!parseTarget()" (click)="openCustom()">
                    <i class="fas fa-plus"></i>
                </button>
            </div>
            <div class="wp-footer-info">
                <i class="fas fa-circle-notch fa-spin me-2" *ngIf="loading"></i>
                <span>Порты сервера читаются через ss</span>
                <button class="wp-icon-btn ms-auto" ngbTooltip="Обновить" container="body" (click)="load()"><i class="fas fa-sync-alt"></i></button>
            </div>
        </div>
    `,
})
export class PortsSectionComponent implements OnChanges {
    @Input() ctx: ServerContext

    ports: ListeningPort[] = []
    loading = false
    error: string | null = null
    customTarget = ''

    constructor (
        public tunnels: TunnelService,
        private contexts: ServerContextService,
        private platform: PlatformService,
        private zone: NgZone,
    ) {}

    ngOnChanges (): void {
        this.ports = []
        this.customTarget = ''
        this.load()
    }

    async load (): Promise<void> {
        this.loading = true
        const ctx = this.ctx
        try {
            const { stdout, stderr } = await this.contexts.exec(ctx, 'ss -tlnpH 2>/dev/null || ss -tln 2>/dev/null | tail -n +2')
            if (!stdout.trim() && stderr.trim()) {
                throw new Error(stderr.trim())
            }
            const byPort = new Map<number, ListeningPort>()
            for (const line of stdout.split('\n')) {
                const cols = line.trim().split(/\s+/)
                if (cols.length < 4) {
                    continue
                }
                const local = cols[3]
                const sep = local.lastIndexOf(':')
                const port = parseInt(local.slice(sep + 1))
                const address = local.slice(0, sep).replace(/^\[|\]$/g, '').replace(/%.*$/, '')
                const process = /users:\(\("([^"]+)"/.exec(line)?.[1] ?? ''
                const existing = byPort.get(port)
                // Prefer the widest bind (0.0.0.0 / ::) when a port is listed twice
                if (port && (!existing || LOOPBACK.includes(existing.address))) {
                    byPort.set(port, { port, address, process: process || existing?.process || '' })
                }
            }
            if (ctx === this.ctx) {
                this.zone.run(() => {
                    this.ports = [...byPort.values()].sort((a, b) => a.port - b.port)
                    this.error = null
                })
            }
        } catch (e) {
            this.zone.run(() => this.error = e.message)
        } finally {
            this.zone.run(() => this.loading = false)
        }
    }

    tunnelsHere (): Tunnel[] {
        return this.tunnels.forServer(this.ctx.key)
    }

    isLoopback (p: ListeningPort): boolean {
        return LOOPBACK.includes(p.address) || p.address.startsWith('127.')
    }

    hasTunnel (p: ListeningPort): boolean {
        return this.tunnelsHere().some(t => t.remotePort === p.port)
    }

    async forward (p: ListeningPort): Promise<void> {
        const host = ['0.0.0.0', '::', '*'].includes(p.address) ? '127.0.0.1' : p.address
        await this.openTunnel(host, p.port, p.port)
    }

    /** "5432" or "10.0.0.5:3306" → target on the server */
    parseTarget (): { host: string, port: number } | null {
        const m = /^(?:(.+):)?(\d{1,5})$/.exec(this.customTarget.trim())
        const port = m ? +m[2] : 0
        return m && port > 0 && port < 65536 ? { host: m[1] || '127.0.0.1', port } : null
    }

    async openCustom (): Promise<void> {
        const target = this.parseTarget()
        if (target && await this.openTunnel(target.host, target.port, target.port)) {
            this.customTarget = ''
        }
    }

    private async openTunnel (host: string, remotePort: number, preferredLocal: number): Promise<boolean> {
        if (!this.ctx.session) {
            return false
        }
        try {
            const localPort = await this.tunnels.freePort(preferredLocal)
            await this.tunnels.open(this.ctx.session, this.ctx.key, this.ctx.name, localPort, host, remotePort)
            return true
        } catch (e) {
            this.platform.showMessageBox({ type: 'error', message: 'Не удалось открыть туннель', detail: e.message, buttons: ['OK'] })
            return false
        }
    }

    browse (host: string, port: number): void {
        this.platform.openExternal(`http://${host}:${port}`)
    }

    copy (text: string): void {
        this.platform.setClipboard({ text })
    }
}
