import { Inject, Injectable, NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import { Command, CommandContext, CommandLocation, CommandProvider } from 'tabby-core'

import { WorkspacePanelComponent } from './panel.component'
import { WorkspacePanelService } from './panel.service'
import { GroupComponent } from './group.component'
import { InfoSectionComponent } from './sections/info.component'
import { SnippetsSectionComponent } from './sections/snippets.component'
import { LogsSectionComponent } from './sections/logs.component'
import { PortsSectionComponent } from './sections/ports.component'
import { HistorySectionComponent } from './sections/history.component'
import { NotesSectionComponent } from './sections/notes.component'

const PANEL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M0 3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3zm10 11h4a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1h-4v12zM9 2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7V2z"/>
    <path d="M11 4.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5z"/>
</svg>`

/** Toggle button in the right part of the tab bar, next to Settings */
@Injectable()
export class WorkspacePanelCommandProvider extends CommandProvider {
    constructor (private panel: WorkspacePanelService) {
        super()
    }

    async provide (_context: CommandContext): Promise<Command[]> {
        return [{
            id: 'workspace-panel:toggle',
            label: 'Панель сервера',
            icon: PANEL_ICON,
            weight: -10,
            locations: [CommandLocation.RightToolbar],
            run: async () => this.panel.toggle(),
        }]
    }
}

@NgModule({
    imports: [CommonModule, FormsModule, NgbModule],
    declarations: [
        WorkspacePanelComponent,
        GroupComponent,
        InfoSectionComponent,
        SnippetsSectionComponent,
        LogsSectionComponent,
        PortsSectionComponent,
        HistorySectionComponent,
        NotesSectionComponent,
    ],
    providers: [
        { provide: CommandProvider, useClass: WorkspacePanelCommandProvider, multi: true },
    ],
})
export default class WorkspacePanelModule {
    constructor (@Inject(CommandProvider) providers: CommandProvider[]) {
        providers.forEach(moveProfileSelectorToRight)
    }
}

/**
 * Tabby's own "Profiles & connections" button lives in the left toolbar and
 * has no setting to move it, so relocate it next to Settings, beside the
 * two panel buttons.
 */
function moveProfileSelectorToRight (provider: CommandProvider): void {
    const provide = provider.provide.bind(provider)
    provider.provide = async (context: CommandContext) => {
        const commands = await provide(context)
        for (const command of commands) {
            if (command.id === 'core:profile-selector' && command.locations?.includes(CommandLocation.LeftToolbar)) {
                command.locations = command.locations
                    .filter(x => x !== CommandLocation.LeftToolbar)
                    .concat(CommandLocation.RightToolbar)
                command.weight = -12
            }
        }
        return commands
    }
}
