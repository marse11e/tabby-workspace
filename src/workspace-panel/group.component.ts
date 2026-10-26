import { Component, Input } from '@angular/core'
import { PanelStoreService } from './panel-store.service'

/** Collapsible group, styled like the SSH sidebar's profile groups */
@Component({
    selector: 'wp-group',
    template: `
        <div class="list-group-item list-group-item-action d-flex align-items-center group-header" (click)="toggle()">
            <i class="fa fa-fw" [ngClass]="collapsed ? 'fa-chevron-right' : 'fa-chevron-down'"></i>
            <i class="fas fa-fw ms-1" [ngClass]="icon" *ngIf="icon"></i>
            <span class="ms-2 me-auto text-truncate">{{ title }}</span>
            <ng-content select="[groupActions]"></ng-content>
            <span class="badge ms-1" [ngClass]="danger && count ? 'bg-danger' : 'bg-secondary'" *ngIf="count !== null">{{ count }}</span>
        </div>
        <ng-container *ngIf="!collapsed">
            <ng-content></ng-content>
        </ng-container>
    `,
})
export class GroupComponent {
    @Input() key: string
    @Input() title: string
    @Input() icon: string | null = null
    @Input() count: number | null = null
    @Input() danger = false

    constructor (private store: PanelStoreService) {}

    get collapsed (): boolean {
        return this.store.isCollapsed(this.key)
    }

    toggle (): void {
        this.store.setCollapsed(this.key, !this.collapsed)
    }
}
