import { Component, Input, OnChanges, OnDestroy, NgZone } from '@angular/core'
import { PlatformService } from 'tabby-core'
import { ServerContext, ServerContextService, shellQuote } from '../server-context.service'

const REFRESH_INTERVAL = 15000

// One round trip: every block is introduced by a "@@name" marker line
const INFO_SCRIPT = `
export LC_ALL=C
echo @@host; hostname
echo @@os; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -sr
echo @@kernel; uname -r
echo @@uptime; uptime -p 2>/dev/null || uptime
echo @@load; cut -d' ' -f1-3 /proc/loadavg 2>/dev/null
echo @@cpus; nproc 2>/dev/null
echo @@mem; free -b 2>/dev/null | awk '/^Mem:/{print $2, $7} /^Swap:/{print $2, $3}'
echo @@disks; df -B1 -P -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs 2>/dev/null | awk 'NR>1{print $2, $3, $6}'
echo @@procs; ps -eo pid=,pcpu=,pmem=,comm= --sort=-pcpu 2>/dev/null | head -6
echo @@failed; systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}'
`

interface Disk { mount: string, size: number, used: number }
interface Proc { pid: string, cpu: number, mem: number, name: string }

interface Info {
    host: string
    os: string
    kernel: string
    uptime: string
    load: string
    cpus: string
    memTotal: number
    memAvailable: number
    swapTotal: number
    swapUsed: number
    disks: Disk[]
    procs: Proc[]
    failed: string[]
}

@Component({
    selector: 'wp-info',
    template: `
        <div class="wp-error" *ngIf="error">{{ error }}</div>
        <div class="wp-list list-group" *ngIf="info">
            <wp-group key="info.system" title="Система" icon="fa-info-circle">
                <div class="list-group-item wp-item">
                    <i class="fas fa-desktop"></i>
                    <div class="wp-grow">
                        <div class="wp-name">{{ info.host }}</div>
                        <div class="wp-desc">{{ info.os }} · {{ info.kernel }}</div>
                    </div>
                </div>
                <div class="list-group-item wp-item">
                    <i class="fas fa-clock"></i>
                    <div class="wp-grow">
                        <div class="wp-name">{{ info.uptime }}</div>
                        <div class="wp-desc">Время работы</div>
                    </div>
                </div>
                <div class="list-group-item wp-item">
                    <i class="fas fa-tachometer-alt"></i>
                    <div class="wp-grow">
                        <div class="wp-name">{{ info.load }}</div>
                        <div class="wp-desc">Нагрузка за 1 / 5 / 15 мин · {{ info.cpus }} CPU</div>
                    </div>
                </div>
            </wp-group>

            <wp-group key="info.memory" title="Память" icon="fa-memory">
                <div class="list-group-item wp-item">
                    <i class="fas fa-memory"></i>
                    <div class="wp-grow">
                        <div class="d-flex"><span class="wp-name">RAM</span>
                            <span class="ms-auto wp-value">{{ size(info.memTotal - info.memAvailable) }} / {{ size(info.memTotal) }}</span></div>
                        <div class="wp-bar"><div [style.width.%]="pct(info.memTotal - info.memAvailable, info.memTotal)"
                             [ngClass]="level(info.memTotal - info.memAvailable, info.memTotal)"></div></div>
                    </div>
                </div>
                <div class="list-group-item wp-item" *ngIf="info.swapTotal">
                    <i class="fas fa-exchange-alt"></i>
                    <div class="wp-grow">
                        <div class="d-flex"><span class="wp-name">Swap</span>
                            <span class="ms-auto wp-value">{{ size(info.swapUsed) }} / {{ size(info.swapTotal) }}</span></div>
                        <div class="wp-bar"><div [style.width.%]="pct(info.swapUsed, info.swapTotal)"
                             [ngClass]="level(info.swapUsed, info.swapTotal)"></div></div>
                    </div>
                </div>
            </wp-group>

            <wp-group key="info.disks" title="Диски" icon="fa-hdd" [count]="info.disks.length">
                <div class="list-group-item wp-item" *ngFor="let d of info.disks">
                    <i class="fas fa-hdd"></i>
                    <div class="wp-grow">
                        <div class="d-flex"><span class="wp-name wp-mono">{{ d.mount }}</span>
                            <span class="ms-auto ps-2 wp-value">{{ size(d.used) }} / {{ size(d.size) }}</span></div>
                        <div class="wp-bar"><div [style.width.%]="pct(d.used, d.size)" [ngClass]="level(d.used, d.size)"></div></div>
                    </div>
                </div>
            </wp-group>

            <wp-group key="info.failed" title="Упавшие сервисы" icon="fa-exclamation-triangle"
                      [count]="info.failed.length" [danger]="true">
                <div class="list-group-item wp-item ok" *ngIf="!info.failed.length">
                    <i class="fas fa-check text-success"></i>
                    <div class="wp-grow wp-name">Всё работает</div>
                </div>
                <div class="list-group-item wp-item danger" *ngFor="let unit of info.failed">
                    <i class="fas fa-times-circle text-danger"></i>
                    <div class="wp-grow">
                        <div class="wp-name wp-mono">{{ unit }}</div>
                        <div class="wp-desc">systemd</div>
                    </div>
                    <span class="wp-actions">
                        <button class="wp-icon-btn" ngbTooltip="Перезапустить" container="body" (click)="restartUnit(unit)"><i class="fas fa-redo"></i></button>
                        <button class="wp-icon-btn" ngbTooltip="Статус в терминале" container="body" (click)="runInTerminal('systemctl status ' + quote(unit))"><i class="fas fa-terminal"></i></button>
                    </span>
                </div>
            </wp-group>

            <wp-group key="info.procs" title="Процессы" icon="fa-microchip">
                <div class="list-group-item wp-item" *ngFor="let p of info.procs">
                    <i class="fas fa-cog"></i>
                    <div class="wp-grow">
                        <div class="wp-name wp-mono">{{ p.name }}</div>
                        <div class="wp-desc">PID {{ p.pid }} · CPU {{ p.cpu }}% · RAM {{ p.mem }}%</div>
                    </div>
                    <span class="wp-actions">
                        <button class="wp-icon-btn danger" ngbTooltip="Завершить процесс" container="body" (click)="kill(p)"><i class="fas fa-skull"></i></button>
                    </span>
                </div>
            </wp-group>
        </div>
        <div class="wp-list" *ngIf="!info"></div>

        <div class="wp-footer">
            <div class="wp-footer-info">
                <i class="fas fa-circle-notch fa-spin me-2" *ngIf="loading"></i>
                <span *ngIf="updatedAt">Обновлено в {{ updatedAt | date:'HH:mm:ss' }}</span>
                <button class="wp-icon-btn ms-auto" ngbTooltip="Обновить" container="body" (click)="load()"><i class="fas fa-sync-alt"></i></button>
            </div>
        </div>
    `,
})
export class InfoSectionComponent implements OnChanges, OnDestroy {
    @Input() ctx: ServerContext

    info: Info | null = null
    error: string | null = null
    loading = false
    updatedAt: Date | null = null

    // Outside Angular: a tick only re-renders when load() brings new data
    private timer = this.zone.runOutsideAngular(() =>
        setInterval(() => !document.hidden && this.load(), REFRESH_INTERVAL))

    constructor (
        private contexts: ServerContextService,
        private platform: PlatformService,
        private zone: NgZone,
    ) {}

    ngOnChanges (): void {
        this.info = null
        this.load()
    }

    ngOnDestroy (): void {
        clearInterval(this.timer)
    }

    async load (): Promise<void> {
        if (this.loading) {
            return
        }
        this.loading = true
        const ctx = this.ctx
        try {
            const { stdout, stderr } = await this.contexts.exec(ctx, INFO_SCRIPT)
            if (ctx !== this.ctx) {
                return
            }
            if (!stdout.trim()) {
                throw new Error(stderr.trim() || 'Пустой ответ сервера')
            }
            this.zone.run(() => {
                this.info = this.parse(stdout)
                this.error = null
                this.updatedAt = new Date()
            })
        } catch (e) {
            this.zone.run(() => this.error = e.message)
        } finally {
            this.zone.run(() => this.loading = false)
        }
    }

    private parse (out: string): Info {
        const blocks: Record<string, string[]> = {}
        let current = ''
        for (const line of out.split('\n')) {
            if (line.startsWith('@@')) {
                current = line.slice(2).trim()
                blocks[current] = []
            } else if (current && line.trim()) {
                blocks[current].push(line.trim())
            }
        }
        const first = (name: string) => (blocks[name] || [])[0] || ''
        const [memTotal, memAvailable] = first('mem').split(' ').map(Number)
        const [swapTotal, swapUsed] = ((blocks.mem || [])[1] || '').split(' ').map(Number)
        return {
            host: first('host'),
            os: first('os'),
            kernel: first('kernel'),
            uptime: first('uptime').replace(/^up /, '').replace(/ weeks?/, ' нед').replace(/ days?/, ' дн')
                .replace(/ hours?/, ' ч').replace(/ minutes?/, ' мин'),
            load: first('load'),
            cpus: first('cpus'),
            memTotal: memTotal || 0,
            memAvailable: memAvailable || 0,
            swapTotal: swapTotal || 0,
            swapUsed: swapUsed || 0,
            disks: (blocks.disks || []).map(l => {
                const [size, used, ...mount] = l.split(' ')
                return { size: +size, used: +used, mount: mount.join(' ') }
            }).filter(d => d.size > 0),
            procs: (blocks.procs || []).map(l => {
                const [pid, cpu, mem, ...name] = l.split(/\s+/)
                return { pid, cpu: +cpu, mem: +mem, name: name.join(' ') }
            }),
            failed: blocks.failed || [],
        }
    }

    size (bytes: number): string {
        const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
        let i = 0
        while (bytes >= 1024 && i < units.length - 1) {
            bytes /= 1024
            i++
        }
        return `${bytes < 10 && i ? bytes.toFixed(1) : Math.round(bytes)} ${units[i]}`
    }

    pct (used: number, total: number): number {
        return total ? Math.min(100, used / total * 100) : 0
    }

    level (used: number, total: number): string {
        const p = this.pct(used, total)
        return p > 90 ? 'crit' : p > 75 ? 'warn' : ''
    }

    quote (value: string): string {
        return shellQuote(value)
    }

    runInTerminal (command: string): void {
        this.contexts.sendToTerminal(this.ctx, command, true)
    }

    async restartUnit (unit: string): Promise<void> {
        await this.runAction(`systemctl restart ${shellQuote(unit)}`)
    }

    async kill (p: Proc): Promise<void> {
        const result = await this.platform.showMessageBox({
            type: 'warning',
            message: `Завершить процесс ${p.name} (PID ${p.pid})?`,
            buttons: ['Завершить', 'Отмена'],
            defaultId: 1,
            cancelId: 1,
        })
        if (result.response === 0) {
            await this.runAction(`kill ${shellQuote(p.pid)}`)
        }
    }

    private async runAction (command: string): Promise<void> {
        const { stderr } = await this.contexts.exec(this.ctx, command)
        if (stderr.trim()) {
            this.platform.showMessageBox({ type: 'error', message: command, detail: stderr.trim(), buttons: ['OK'] })
        }
        await this.load()
    }
}
