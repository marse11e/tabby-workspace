import { Injectable } from "@angular/core";
import { HotkeyDescription, HotkeyProvider } from "tabby-core";

/** Listed in Settings → Hotkeys, unbound by default */
@Injectable()
export class BackgroundHotkeyProvider extends HotkeyProvider {
  async provide(): Promise<HotkeyDescription[]> {
    return [
      { id: "background-next", name: "Фон: следующая картинка" },
      { id: "background-toggle", name: "Фон: включить / выключить" },
    ];
  }
}
