import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'

export type PanelSection = 'info' | 'snippets' | 'logs' | 'ports' | 'history' | 'notes'

export interface Snippet {
    id: string
    name: string
    command: string
    /** Server key, or null for every server */
    server: string | null
}

/** Persistent data of the right panel, kept in Tabby's config */
@Injectable({ providedIn: 'root' })
export class PanelStoreService {
    constructor (private config: ConfigService) {}

    private get store (): any {
        const root = this.config.store.pluginConfig ??= {}
        return root['workspace-panel'] ??= {}
    }

    private save (): void {
        this.config.save()
    }

    get section (): PanelSection {
        return this.store.section || 'info'
    }

    set section (value: PanelSection) {
        this.store.section = value
        this.save()
    }

    get snippets (): Snippet[] {
        return this.store.snippets || []
    }

    saveSnippet (snippet: Snippet): void {
        const list = this.snippets.filter(s => s.id !== snippet.id)
        list.push(snippet)
        list.sort((a, b) => a.name.localeCompare(b.name))
        this.store.snippets = list
        this.save()
    }

    deleteSnippet (id: string): void {
        this.store.snippets = this.snippets.filter(s => s.id !== id)
        this.save()
    }

    isCollapsed (key: string): boolean {
        return !!(this.store.collapsed || {})[key]
    }

    setCollapsed (key: string, value: boolean): void {
        this.store.collapsed = { ...this.store.collapsed || {}, [key]: value }
        this.save()
    }

    getNote (server: string): string {
        return (this.store.notes || {})[server] || ''
    }

    setNote (server: string, text: string): void {
        this.store.notes = { ...this.store.notes || {}, [server]: text }
        this.save()
    }

    getLogFiles (server: string): string[] {
        return (this.store.logFiles || {})[server] || []
    }

    setLogFiles (server: string, files: string[]): void {
        this.store.logFiles = { ...this.store.logFiles || {}, [server]: files }
        this.save()
    }
}
