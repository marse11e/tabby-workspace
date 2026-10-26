import { Component, Input, OnChanges, OnDestroy } from '@angular/core'
import { PanelStoreService } from '../panel-store.service'
import { ServerContext } from '../server-context.service'

const SAVE_DELAY = 600

@Component({
    selector: 'wp-notes',
    template: `
        <div class="list-group">
            <div class="list-group-item d-flex align-items-center group-header">
                <i class="fas fa-fw fa-sticky-note"></i>
                <span class="ms-2 me-auto text-truncate">Заметка к {{ ctx.name }}</span>
                <span class="wp-muted" *ngIf="saved"><i class="fas fa-check me-1"></i>Сохранено</span>
            </div>
        </div>
        <textarea class="form-control wp-notes"
                  placeholder="Где лежит проект, как деплоить, какие сервисы здесь крутятся…&#10;&#10;Пароли сюда лучше не писать: заметки хранятся в конфиге Tabby открытым текстом."
                  [(ngModel)]="text"
                  (ngModelChange)="scheduleSave()"></textarea>
    `,
    styles: [`
        .wp-notes {
            flex: 1;
            margin: 12px;
            width: auto !important;
            resize: none;
            font-size: 13px;
            line-height: 1.5;
        }
    `],
})
export class NotesSectionComponent implements OnChanges, OnDestroy {
    @Input() ctx: ServerContext

    text = ''
    saved = false

    private server = ''
    private timer: any = null

    constructor (private store: PanelStoreService) {}

    ngOnChanges (): void {
        this.flush()
        this.server = this.ctx.key
        this.text = this.store.getNote(this.server)
        this.saved = false
    }

    ngOnDestroy (): void {
        this.flush()
    }

    scheduleSave (): void {
        this.saved = false
        clearTimeout(this.timer)
        this.timer = setTimeout(() => this.flush(), SAVE_DELAY)
    }

    private flush (): void {
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
            this.store.setNote(this.server, this.text)
            this.saved = true
        }
    }
}
