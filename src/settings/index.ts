import { Component, Injectable, NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ConfigService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'

import { BackgroundSettingsTabComponent } from '../background/settings-tab.component'
import { BackgroundExtrasSettingsComponent } from '../background/extras-settings.component'
import { ServerStatsSettingsComponent } from '../server-stats/components/settings.component'

type Page = 'background' | 'stats'

interface SubPage { id: string, title: string, icon: string, component: any }

const PAGES: { id: Page, title: string, icon: string, subpages: SubPage[] }[] = [
    {
        id: 'background', title: 'Фон', icon: 'fa-image', subpages: [
            { id: 'images', title: 'Картинки и эффекты', icon: 'fa-images', component: BackgroundSettingsTabComponent },
            { id: 'extras', title: 'Умный фон', icon: 'fa-magic', component: BackgroundExtrasSettingsComponent },
        ],
    },
    {
        id: 'stats', title: 'Мониторинг сервера', icon: 'fa-chart-line', subpages: [
            { id: 'stats', title: '', icon: '', component: ServerStatsSettingsComponent },
        ],
    },
]

/** One settings tab for the plugin, with a switch between its parts */
@Component({
    template: `
        <h3>Workspace</h3>
        <div class="btn-group mb-4">
            <button *ngFor="let p of pages" class="btn"
                    [ngClass]="p.id === page ? 'btn-primary' : 'btn-secondary'"
                    (click)="select(p.id)">
                <i class="fas fa-fw me-1" [ngClass]="p.icon"></i>{{ p.title }}
            </button>
        </div>
        <ng-container *ngFor="let p of pages">
            <ng-container *ngIf="p.id === page">
                <ul class="nav nav-tabs mb-3" *ngIf="p.subpages.length > 1">
                    <li class="nav-item" *ngFor="let sp of p.subpages">
                        <a class="nav-link" href="javascript:void(0)" [class.active]="sp.id === subpage(p)" (click)="selectSub(p, sp.id)">
                            <i class="fas fa-fw me-1" [ngClass]="sp.icon"></i>{{ sp.title }}
                        </a>
                    </li>
                </ul>
                <ng-container *ngFor="let sp of p.subpages">
                    <ng-container *ngIf="sp.id === subpage(p)">
                        <ng-container *ngComponentOutlet="sp.component"></ng-container>
                    </ng-container>
                </ng-container>
            </ng-container>
        </ng-container>
    `,
})
export class WorkspaceSettingsTabComponent {
    pages = PAGES
    page: Page

    constructor (private config: ConfigService) {
        this.page = this.config.store.pluginConfig?.['workspace-panel']?.settingsPage || 'background'
    }

    private subpages: Record<string, string> = {}

    subpage (p: { id: Page, subpages: SubPage[] }): string {
        return this.subpages[p.id] ?? p.subpages[0].id
    }

    selectSub (p: { id: Page }, id: string): void {
        this.subpages[p.id] = id
    }

    select (page: Page): void {
        this.page = page
        const root = this.config.store.pluginConfig ??= {}
        root['workspace-panel'] = { ...root['workspace-panel'] || {}, settingsPage: page }
        this.config.save()
    }
}

@Injectable()
export class WorkspaceSettingsTabProvider extends SettingsTabProvider {
    id = 'tabby-workspace'
    icon = 'layer-group'
    title = 'Workspace'

    getComponentType (): any {
        return WorkspaceSettingsTabComponent
    }
}

@NgModule({
    imports: [CommonModule],
    declarations: [WorkspaceSettingsTabComponent],
    providers: [
        { provide: SettingsTabProvider, useClass: WorkspaceSettingsTabProvider, multi: true },
    ],
})
export default class WorkspaceSettingsModule {}
