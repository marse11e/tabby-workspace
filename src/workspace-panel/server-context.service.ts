import { Injectable, NgZone } from '@angular/core'
import { exec as execProcess } from 'child_process'
import { Observable, Subject, merge } from 'rxjs'
import { debounceTime, map, distinctUntilChanged } from 'rxjs/operators'
import { AppService } from 'tabby-core'

export const LOCAL_KEY = 'local'

/** The machine the active tab is connected to */
export interface ServerContext {
    key: string
    name: string
    kind: 'ssh' | 'local'
    address: string
    tab: any
    session?: any
}

export interface ExecResult {
    stdout: string
    stderr: string
}

/**
 * Runs a shell command on a remote host over a fresh exec channel of an
 * already authenticated Tabby SSH session, so it works with password logins
 * and does not touch the user's interactive shell.
 */
export async function execInSession (session: any, command: string, timeoutMs = 20000): Promise<ExecResult> {
    const ssh = session.ssh
    const channel = await ssh.activateChannel(await ssh.openSessionChannel())
    const decoder = new TextDecoder()
    const errDecoder = new TextDecoder()
    let stdout = ''
    let stderr = ''
    const done = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            channel.close().catch(() => null)
            reject(new Error(`Сервер не ответил за ${Math.round(timeoutMs / 1000)} секунд`))
        }, timeoutMs)
        channel.data$.subscribe((data: Uint8Array) => stdout += decoder.decode(data, { stream: true }))
        channel.extendedData$.subscribe(([, data]: [number, Uint8Array]) => stderr += errDecoder.decode(data, { stream: true }))
        channel.closed$.subscribe(() => {
            clearTimeout(timeout)
            resolve()
        })
    })
    await channel.requestExec(command)
    await done
    return { stdout, stderr }
}

export function execLocal (command: string, timeoutMs = 20000): Promise<ExecResult> {
    return new Promise(resolve => {
        execProcess(command, { shell: '/bin/bash', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({ stdout, stderr: stderr || (error && !stdout ? error.message : '') })
        })
    })
}

export function shellQuote (value: string): string {
    return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

@Injectable({ providedIn: 'root' })
export class ServerContextService {
    /** Emits whenever the active tab (or its connection state) changes */
    readonly context$: Observable<ServerContext | null>

    private changed = new Subject<void>()

    constructor (private app: AppService, zone: NgZone) {
        this.context$ = merge(
            this.app.activeTabChange$,
            this.app.tabsChanged$,
            this.changed,
            // SSH tabs finish connecting after they become active. The timer
            // runs outside Angular so its ticks don't re-render the whole app
            new Observable<void>(subscriber => {
                const id = zone.runOutsideAngular(() => setInterval(() => subscriber.next(), 3000))
                return () => clearInterval(id)
            }),
        ).pipe(
            debounceTime(100),
            map(() => this.current()),
            distinctUntilChanged((a, b) => a?.key === b?.key && a?.tab === b?.tab && !!a?.session === !!b?.session),
        )
    }

    refresh (): void {
        this.changed.next()
    }

    current (): ServerContext | null {
        let tab: any = this.app.activeTab
        while (tab?.getFocusedTab?.()) {
            tab = tab.getFocusedTab()
        }
        if (!tab) {
            return null
        }
        const session = tab.sshSession
        if (session?.profile) {
            const o: any = session.profile.options || {}
            return {
                key: `ssh:${o.user || ''}@${o.host}:${o.port || 22}`,
                name: session.profile.name || o.host,
                kind: 'ssh',
                address: o.host,
                tab,
                session: session.open && typeof session.ssh?.openSessionChannel === 'function' ? session : undefined,
            }
        }
        if (typeof tab.sendInput === 'function') {
            return { key: LOCAL_KEY, name: 'Этот компьютер', kind: 'local', address: 'localhost', tab }
        }
        return null
    }

    isReady (ctx: ServerContext | null): boolean {
        return !!ctx && (ctx.kind === 'local' || !!ctx.session)
    }

    async exec (ctx: ServerContext, command: string, timeoutMs?: number): Promise<ExecResult> {
        if (ctx.kind === 'ssh') {
            if (!ctx.session?.open) {
                throw new Error('SSH-соединение ещё не установлено')
            }
            return execInSession(ctx.session, command, timeoutMs)
        }
        return execLocal(command, timeoutMs)
    }

    /** Types text into the tab's terminal; `run` also presses Enter */
    sendToTerminal (ctx: ServerContext, text: string, run: boolean): void {
        ctx.tab.sendInput?.(run ? text + '\r' : text)
        ctx.tab.frontend?.focus?.()
    }
}
