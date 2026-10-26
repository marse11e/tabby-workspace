import { CommonModule } from "@angular/common";
import { NgModule } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { NgbModule } from "@ng-bootstrap/ng-bootstrap";
import TabbyCoreModule, { ConfigProvider, ConfigService, HotkeyProvider } from "tabby-core";

import { BackgroundService } from "./background.service";
import { BackgroundConfigProvider } from "./config.provider";
import { BackgroundSettingsTabComponent } from "./settings-tab.component";
import { BackgroundExtrasSettingsComponent } from "./extras-settings.component";
import { BackgroundExtrasService } from "./extras.service";
import { BackgroundHotkeyProvider } from "./hotkeys.provider";

@NgModule({
  imports: [CommonModule, FormsModule, TabbyCoreModule, NgbModule],
  providers: [
    { provide: ConfigProvider, useClass: BackgroundConfigProvider, multi: true },
    { provide: HotkeyProvider, useClass: BackgroundHotkeyProvider, multi: true },
  ],
  entryComponents: [BackgroundSettingsTabComponent, BackgroundExtrasSettingsComponent],
  declarations: [BackgroundSettingsTabComponent, BackgroundExtrasSettingsComponent],
})
export default class BackgroundModule {
  constructor(
    public config: ConfigService,
    private readonly background: BackgroundService,
    private readonly extras: BackgroundExtrasService,
  ) {}
}
