import { NgModule } from '@angular/core'

import BackgroundModule from './background'
import ServerStatsModule from './server-stats'
import SSHSidebarModule from './ssh-sidebar'
import WorkspacePanelModule from './workspace-panel'
import WorkspaceSettingsModule from './settings'

@NgModule({
    imports: [BackgroundModule, ServerStatsModule, SSHSidebarModule, WorkspacePanelModule, WorkspaceSettingsModule],
})
export default class TabbyWorkspaceModule {}
