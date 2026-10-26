import { NgModule, Injectable } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import {
    Command,
    CommandContext,
    CommandLocation,
    CommandProvider,
    ConfigService,
} from 'tabby-core'
import { SSHSidebarComponent } from './components/sshSidebar.component'
import { SSHSidebarService } from './services/sshSidebar.service'
import { DockerSectionComponent } from '../docker/docker-section.component'

/**
 * Configuration interface for SSH sidebar settings
 */
export interface SSHSidebarConfig {
    enabled?: boolean
    position?: 'left' | 'right'
    showInToolbar?: boolean
    sidebarVisible?: boolean
    sidebarCollapsed?: boolean
}

const SIDEBAR_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M0 3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3zm6 11h8a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H6v12zM5 2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3V2z"/>
    <path d="M2 4.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z"/>
</svg>`

/**
 * Toggle button in the right part of the tab bar, next to Settings and the
 * server panel button
 */
@Injectable()
export class SSHSidebarCommandProvider extends CommandProvider {
    constructor (
        private config: ConfigService,
        private sidebarService: SSHSidebarService,
    ) {
        super()
    }

    async provide (_context: CommandContext): Promise<Command[]> {
        const pluginConfig = this.config.store.pluginConfig?.['ssh-sidebar'] as SSHSidebarConfig || {}
        if (pluginConfig.showInToolbar === false) {
            return []
        }
        return [{
            id: 'ssh-sidebar:toggle',
            label: 'Панель подключений',
            icon: SIDEBAR_ICON,
            weight: -11,
            locations: [CommandLocation.RightToolbar],
            run: async () => this.sidebarService.toggle(),
        }]
    }
}

/**
 * Main module for the SSH Sidebar plugin
 */
@NgModule({
    imports: [
        CommonModule,
        FormsModule,
    ],
    declarations: [
        SSHSidebarComponent,
        DockerSectionComponent,
    ],
    providers: [
        {
            provide: CommandProvider,
            useClass: SSHSidebarCommandProvider,
            multi: true,
        },
        SSHSidebarService,
    ],
})
// The sidebar stays closed on startup (and loads nothing) until it's opened from the toolbar
export default class SSHSidebarModule {}
