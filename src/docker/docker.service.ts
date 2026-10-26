import { Injectable } from '@angular/core'
import { execFile } from 'child_process'
import { AppService, BaseTabComponent, ConfigService, PartialProfile, Profile, ProfilesService } from 'tabby-core'
import { SSHProfile } from 'tabby-ssh'
import { execInSession, shellQuote } from '../workspace-panel/server-context.service'

export const LOCAL_HOST_ID = 'local'

export interface DockerHost {
    id: string
    name: string
    profile?: PartialProfile<SSHProfile>
    /** Open Tabby SSH session to this host — used instead of the system ssh client */
    session?: any
}

export interface DockerContainer {
    id: string
    name: string
    image: string
    state: string
    status: string
    ports: number[]
    project: string | null
}

/**
 * Runs the docker CLI locally or on a server. For a server with an open SSH
 * tab, commands go through that Tabby session (so password logins work);
 * otherwise through the system `ssh` client, which needs key-based auth
 * because it runs non-interactively (BatchMode). Shell and logs open in a
 * terminal tab, where a password prompt works.
 */
@Injectable({ providedIn: 'root' })
export class DockerService {
    constructor(
        private config: ConfigService,
        private profiles: ProfilesService,
        private app: AppService,
    ) {}

    private get pluginConfig(): any {
        if (!this.config.store.pluginConfig) {
            this.config.store.pluginConfig = {}
        }
        if (!this.config.store.pluginConfig['ssh-sidebar']) {
            this.config.store.pluginConfig['ssh-sidebar'] = {}
        }
        return this.config.store.pluginConfig['ssh-sidebar']
    }

    get remoteHostIds(): string[] {
        return this.pluginConfig.dockerHosts || []
    }

    isRemoteHost(profileId: string): boolean {
        return this.remoteHostIds.includes(profileId)
    }

    toggleRemoteHost(profileId: string): void {
        const ids = this.remoteHostIds.filter(x => x !== profileId)
        if (!this.isRemoteHost(profileId)) {
            ids.push(profileId)
        }
        this.pluginConfig.dockerHosts = ids
        this.config.save()
    }

    isCollapsed(key: string): boolean {
        return !!(this.pluginConfig.dockerCollapsed || {})[key]
    }

    setCollapsed(key: string, value: boolean): void {
        this.pluginConfig.dockerCollapsed = { ...this.pluginConfig.dockerCollapsed || {}, [key]: value }
        this.config.save()
    }

    async getHosts(): Promise<DockerHost[]> {
        const hosts: DockerHost[] = [{ id: LOCAL_HOST_ID, name: 'Этот компьютер' }]
        const sessions = this.getOpenSessions()
        const ids = this.remoteHostIds
        if (ids.length) {
            const all = await this.profiles.getProfiles() as PartialProfile<Profile>[]
            for (const id of ids) {
                const profile = all.find(p => p.id === id && p.type === 'ssh') as PartialProfile<SSHProfile> | undefined
                if (profile) {
                    const session = sessions.find(x => this.sameServer(x.profile, profile))
                    hosts.push({ id, name: profile.name, profile, session })
                }
            }
        }
        // Servers connected in a tab show up automatically
        for (const session of sessions) {
            const profile = session.profile as PartialProfile<SSHProfile>
            if (!hosts.some(h => h.profile && this.sameServer(h.profile, profile))) {
                hosts.push({ id: profile.id || this.serverKey(profile), name: profile.name, profile, session })
            }
        }
        return hosts
    }

    /** Authenticated SSH sessions of the open tabs, one per server */
    private getOpenSessions(): any[] {
        const sessions: any[] = []
        const visit = (tab: BaseTabComponent) => {
            const children = (tab as any).getAllTabs?.()
            if (children) {
                children.forEach(visit)
                return
            }
            const session = (tab as any).sshSession
            if (session?.open && session.profile && typeof session.ssh?.openSessionChannel === 'function'
                && !sessions.some(x => this.sameServer(x.profile, session.profile))) {
                sessions.push(session)
            }
        }
        this.app.tabs.forEach(visit)
        return sessions
    }

    private serverKey(profile: PartialProfile<SSHProfile>): string {
        const o: any = profile.options || {}
        return `ssh:${o.user || ''}@${o.host}:${o.port || 22}`
    }

    private sameServer(a: PartialProfile<SSHProfile>, b: PartialProfile<SSHProfile>): boolean {
        return (!!a.id && a.id === b.id) || this.serverKey(a) === this.serverKey(b)
    }

    async listContainers(host: DockerHost): Promise<DockerContainer[]> {
        const out = await this.exec(host, ['ps', '-a', '--no-trunc', '--format', '{{json .}}'])
        return out.split('\n').filter(x => x.trim()).map(line => {
            const raw = JSON.parse(line)
            const labels: string = raw.Labels || ''
            const project = /(?:^|,)com\.docker\.compose\.project=([^,]+)/.exec(labels)
            const ports = new Set<number>()
            for (const m of (raw.Ports || '').matchAll(/:(\d+)->/g)) {
                ports.add(parseInt(m[1]))
            }
            return {
                id: raw.ID,
                name: raw.Names,
                image: raw.Image,
                state: raw.State,
                status: raw.Status,
                ports: [...ports].sort((a, b) => a - b),
                project: project ? project[1] : null,
            }
        }).sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running') || a.name.localeCompare(b.name))
    }

    async run(host: DockerHost, args: string[]): Promise<void> {
        await this.exec(host, args)
    }

    /** Opens a terminal tab running `docker <args>` on the host */
    openTab(host: DockerHost, title: string, args: string[]): void {
        const command = host.profile ? 'ssh' : 'docker'
        const commandArgs = host.profile
            ? ['-t', ...this.sshArgs(host.profile), this.remoteCommand(args)]
            : args
        this.profiles.openNewTabForProfile({
            type: 'local',
            name: title,
            options: { command, args: commandArgs, env: {}, cwd: '' },
        } as any)
    }

    hostAddress(host: DockerHost): string {
        return host.profile?.options?.host || 'localhost'
    }

    private async exec(host: DockerHost, args: string[]): Promise<string> {
        if (host.session?.open) {
            return this.execInSession(host, args)
        }
        return this.execProcess(host, args)
    }

    private async execInSession(host: DockerHost, args: string[]): Promise<string> {
        const { stdout, stderr } = await execInSession(host.session, this.remoteCommand(args))
        if (stderr.trim() && !stdout.trim()) {
            throw new Error(this.explainError(host, stderr.trim()))
        }
        return stdout
    }

    private execProcess(host: DockerHost, args: string[]): Promise<string> {
        const command = host.profile ? 'ssh' : 'docker'
        const commandArgs = host.profile
            ? ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', ...this.sshArgs(host.profile), this.remoteCommand(args)]
            : args
        return new Promise((resolve, reject) => {
            execFile(command, commandArgs, { timeout: 20000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(this.explainError(host, (stderr || error.message).trim())))
                } else {
                    resolve(stdout)
                }
            })
        })
    }

    private explainError(host: DockerHost, message: string): string {
        if (/ENOENT/.test(message)) {
            return host.profile ? 'Не найден ssh-клиент' : 'Docker не установлен'
        }
        if (/permission denied.*docker\.sock/i.test(message)) {
            return 'Нет доступа к Docker: добавьте пользователя в группу docker'
        }
        if (/Cannot connect to the Docker daemon/i.test(message)) {
            return 'Docker не запущен'
        }
        if (host.profile && /Permission denied \(|password/i.test(message)) {
            return 'Нужен вход по SSH-ключу'
        }
        if (/command not found|docker: not found/i.test(message)) {
            return 'Docker не установлен на сервере'
        }
        return message.split('\n').pop() || message
    }

    private sshArgs(profile: PartialProfile<SSHProfile>): string[] {
        const o: any = profile.options || {}
        const args = ['-p', String(o.port || 22)]
        for (const key of o.privateKeys || []) {
            args.push('-i', String(key).replace(/^file:\/\//, ''))
        }
        args.push(o.user ? `${o.user}@${o.host}` : o.host)
        return args
    }

    private remoteCommand(args: string[]): string {
        return ['docker', ...args].map(shellQuote).join(' ')
    }
}
