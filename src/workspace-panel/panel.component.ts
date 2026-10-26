import { Component, EventEmitter, OnDestroy, OnInit, Output, ViewEncapsulation, NgZone } from '@angular/core'
import { Subscription } from 'rxjs'
import { PanelSection, PanelStoreService } from './panel-store.service'
import { ServerContext, ServerContextService } from './server-context.service'

interface SectionInfo {
    id: PanelSection
    title: string
    icon: string
    /** Needs a shell on the machine (not just a terminal tab) */
    needsExec: boolean
}

const SECTIONS: SectionInfo[] = [
    { id: 'info', title: 'Сервер', icon: 'fa-server', needsExec: true },
    { id: 'snippets', title: 'Сниппеты', icon: 'fa-bolt', needsExec: false },
    { id: 'logs', title: 'Логи', icon: 'fa-file-alt', needsExec: true },
    { id: 'ports', title: 'Порты и туннели', icon: 'fa-network-wired', needsExec: true },
    { id: 'history', title: 'История команд', icon: 'fa-history', needsExec: true },
    { id: 'notes', title: 'Заметки', icon: 'fa-sticky-note', needsExec: false },
]

/**
 * Right panel: tools for the machine of the active tab, switched with an
 * icon rail on the right edge.
 */
@Component({
    selector: 'workspace-panel',
    encapsulation: ViewEncapsulation.None,
    template: `
        <div class="wp">
            <div class="wp-main">
                <div class="wp-body">
                    <div class="wp-empty" *ngIf="!ctx">
                        <i class="fas fa-terminal"></i>
                        <p>Откройте терминал или SSH-подключение</p>
                    </div>
                    <div class="wp-empty" *ngIf="ctx && current.needsExec && !contexts.isReady(ctx)">
                        <i class="fas fa-circle-notch fa-spin"></i>
                        <p>Ждём подключения к {{ ctx.name }}…</p>
                    </div>
                    <ng-container *ngIf="ctx && (!current.needsExec || contexts.isReady(ctx))">
                        <wp-info *ngIf="section === 'info'" [ctx]="ctx"></wp-info>
                        <wp-snippets *ngIf="section === 'snippets'" [ctx]="ctx"></wp-snippets>
                        <wp-logs *ngIf="section === 'logs'" [ctx]="ctx"></wp-logs>
                        <wp-ports *ngIf="section === 'ports'" [ctx]="ctx"></wp-ports>
                        <wp-history *ngIf="section === 'history'" [ctx]="ctx"></wp-history>
                        <wp-notes *ngIf="section === 'notes'" [ctx]="ctx"></wp-notes>
                    </ng-container>
                </div>
            </div>

            <div class="wp-rail">
                <button *ngFor="let s of sections"
                        class="wp-rail-btn"
                        [class.active]="s.id === section"
                        [ngbTooltip]="s.title"
                        placement="left"
                        container="body"
                        (click)="select(s.id)">
                    <i class="fas fa-fw" [ngClass]="s.icon"></i>
                </button>
            </div>
        </div>
    `,
    styles: [`
        workspace-panel { display: flex; width: 100%; height: 100%; }

        .wp {
            display: flex;
            width: 100%;
            height: 100%;
            font-size: 13px;
            color: var(--bs-body-color);
        }

        .wp-main { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }

        .wp-body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
        .wp-body > * { display: flex; flex-direction: column; flex: 1; min-height: 0; }

        .wp-rail {
            width: 44px;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            padding-top: 8px;
            border-left: 1px solid var(--bs-border-color);
            background: rgba(0, 0, 0, 0.15);
        }
        .wp-rail-btn {
            width: 34px;
            height: 34px;
            border: none;
            border-radius: 6px;
            background: transparent;
            color: var(--bs-body-color);
            opacity: 0.55;
        }
        .wp-rail-btn:hover { opacity: 0.9; background: var(--bs-tertiary-bg); }
        .wp-rail-btn.active { opacity: 1; background: var(--bs-primary); color: #fff; }

        .wp-empty { text-align: center; padding: 40px 20px; opacity: 0.6; }
        .wp-empty i { font-size: 24px; margin-bottom: 10px; }

        /* Shared building blocks, matching the SSH sidebar */
        .wp-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0; border-radius: 0; }
        .wp-list > .list-group-item, .wp-list wp-group > .list-group-item { border-radius: 0; }

        .wp .group-header {
            background: var(--bs-tertiary-bg);
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            padding: 10px 16px;
        }
        .wp .group-header:hover { background: var(--bs-secondary-bg); }
        .wp .group-header .badge { font-size: 9px; padding: 2px 6px; }

        .wp-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            border-left: 3px solid transparent;
            transition: background 0.2s ease;
            min-width: 0;
        }
        .wp-item.clickable { cursor: pointer; }
        .wp-item.clickable:hover, .wp-item:hover { background: var(--bs-tertiary-bg); }
        .wp-item.danger { border-left-color: var(--bs-danger); }
        .wp-item.ok { border-left-color: var(--bs-success); }
        .wp-item > i:first-child { width: 1.25rem; text-align: center; flex-shrink: 0; opacity: 0.7; }
        .wp-name { font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wp-desc { font-size: 11px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wp-grow { flex: 1; min-width: 0; }
        .wp-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 0.2s ease; }
        .wp-item:hover .wp-actions { opacity: 1; }
        .wp-actions.always { opacity: 1; }
        .wp-value { font-size: 11px; opacity: 0.6; white-space: nowrap; }
        .wp-mono { font-family: var(--terminal-font, monospace); }
        .wp-ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wp-muted { opacity: 0.6; font-size: 11px; }

        .wp-icon-btn {
            border: none; background: transparent; color: inherit;
            padding: 2px 6px; border-radius: 4px; opacity: 0.7;
        }
        .wp-icon-btn:hover { opacity: 1; color: var(--bs-primary); }
        .wp-icon-btn.danger:hover { color: var(--bs-danger); }
        .wp-icon-btn.active { opacity: 1; color: var(--bs-success); }

        .wp-error { color: var(--bs-danger); padding: 10px 16px; font-size: 12px; }
        .wp-hint { padding: 10px 16px; font-size: 11px; opacity: 0.6; }
        .wp-bar { height: 4px; border-radius: 2px; background: var(--bs-secondary-bg); overflow: hidden; margin-top: 4px; }
        .wp-bar > div { height: 100%; background: var(--bs-success); }
        .wp-bar > div.warn { background: var(--bs-warning); }
        .wp-bar > div.crit { background: var(--bs-danger); }

        /* Bottom bar with inputs, same as the SSH sidebar search */
        .wp-footer {
            padding: 12px;
            border-top: 1px solid var(--bs-border-color);
            display: flex;
            flex-direction: column;
            gap: 8px;
            flex-shrink: 0;
        }
        .wp-footer .input-group-text, .wp-top .input-group-text {
            background: var(--bs-tertiary-bg);
            border-right: none;
            color: var(--bs-secondary-color);
        }
        .wp-footer input, .wp-top input {
            background: var(--bs-tertiary-bg);
            border-left: none;
            color: var(--bs-body-color);
        }
        .wp-footer .btn, .wp-top .btn { border-color: var(--bs-border-color); }
        .wp-footer-info { display: flex; align-items: center; font-size: 11px; opacity: 0.7; }

        .wp-top {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--bs-border-color);
            flex-shrink: 0;
        }

        .wp-form {
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            border-bottom: 1px solid var(--bs-border-color);
            background: var(--bs-tertiary-bg);
            flex-shrink: 0;
        }
        .wp-form .form-control, .wp-form .form-select { font-size: 13px; }
        .wp-form textarea { font-family: var(--terminal-font, monospace); font-size: 12px; }
        .wp-form label { font-size: 11px; opacity: 0.7; margin-bottom: 2px; }
        .wp-form-buttons { display: flex; gap: 6px; justify-content: flex-end; }
    `],
})
export class WorkspacePanelComponent implements OnInit, OnDestroy {
    @Output() closed = new EventEmitter<void>()

    sections = SECTIONS
    section: PanelSection
    ctx: ServerContext | null = null

    private sub: Subscription | null = null

    constructor (
        public contexts: ServerContextService,
        private store: PanelStoreService,
        private zone: NgZone,
    ) {
        this.section = this.store.section
    }

    get current (): SectionInfo {
        return SECTIONS.find(s => s.id === this.section) ?? SECTIONS[0]
    }

    ngOnInit (): void {
        this.ctx = this.contexts.current()
        this.sub = this.contexts.context$.subscribe(ctx => this.zone.run(() => this.ctx = ctx))
    }

    ngOnDestroy (): void {
        this.sub?.unsubscribe()
    }

    select (section: PanelSection): void {
        this.section = section
        this.store.section = section
    }
}
