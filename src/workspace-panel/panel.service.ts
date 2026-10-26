import { Injectable, ComponentFactoryResolver, ApplicationRef, Injector, EmbeddedViewRef, ComponentRef } from '@angular/core'
import { WorkspacePanelComponent } from './panel.component'

const PANEL_WIDTH = 360

/**
 * Places the right panel as the last child of Tabby's `.window` row
 * container (the same flex row the SSH sidebar joins on the left), so the
 * terminal simply shrinks while it is open. Closed on every start.
 */
@Injectable({ providedIn: 'root' })
export class WorkspacePanelService {
    private componentRef: ComponentRef<WorkspacePanelComponent> | null = null
    private wrapper: HTMLElement | null = null

    constructor (
        private componentFactoryResolver: ComponentFactoryResolver,
        private appRef: ApplicationRef,
        private injector: Injector,
    ) {}

    get visible (): boolean {
        return !!this.componentRef
    }

    toggle (): void {
        if (this.visible) {
            this.hide()
        } else {
            this.show()
        }
    }

    show (): void {
        const container = document.querySelector('app-root .window') as HTMLElement | null
        if (this.visible || !container) {
            return
        }
        const factory = this.componentFactoryResolver.resolveComponentFactory(WorkspacePanelComponent)
        this.componentRef = factory.create(this.injector)
        this.componentRef.instance.closed.subscribe(() => this.hide())
        this.appRef.attachView(this.componentRef.hostView)

        const wrapper = document.createElement('div')
        wrapper.className = 'workspace-panel-wrapper'
        wrapper.style.cssText = `
            width: ${PANEL_WIDTH}px;
            flex: 0 0 ${PANEL_WIDTH}px;
            min-width: 0;
            height: 100%;
            overflow: hidden;
            display: flex;
            border-left: 1px solid var(--bs-border-color, #333);
            background: var(--bs-body-bg, #1e1e1e);
            z-index: 10;
        `
        wrapper.appendChild((this.componentRef.hostView as EmbeddedViewRef<any>).rootNodes[0])
        container.appendChild(wrapper)
        this.wrapper = wrapper
        // Same rule the SSH sidebar uses; harmless if it's already present
        this.ensureContentCanShrink()
    }

    hide (): void {
        if (this.componentRef) {
            this.appRef.detachView(this.componentRef.hostView)
            this.componentRef.destroy()
            this.componentRef = null
        }
        this.wrapper?.remove()
        this.wrapper = null
    }

    private ensureContentCanShrink (): void {
        if (document.getElementById('workspace-panel-layout-css')) {
            return
        }
        const style = document.createElement('style')
        style.id = 'workspace-panel-layout-css'
        style.textContent = `
            app-root .window > .content.main {
                flex: 1 1 0 !important;
                width: auto !important;
                min-width: 0 !important;
            }
        `
        document.head.appendChild(style)
    }
}
