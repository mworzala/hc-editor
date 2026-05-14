import { Events } from '@wailsio/runtime'

import type { MenuController } from '@hollowcube/common/platform'

// Desktop `MenuController` impl. The frontend owns the dynamic menu structure
// and pushes it wholesale to Go via `menu:set-items`; click events arrive
// back as `menu:invoke` carrying the originating action id.

const MENU_INVOKE_EVENT = 'menu:invoke'
const MENU_SET_ITEMS_EVENT = 'menu:set-items'

export const desktopMenuController: MenuController = {
    setItems(items) {
        // The Wails runtime types `Emit` against a registered-events table.
        // Our menu:set-items event is custom and registered Go-side only; the
        // typed table is empty here, so cast to satisfy the second-arg shape.
        void Events.Emit(MENU_SET_ITEMS_EVENT, { items } as never)
    },
    onInvoke(handler) {
        return Events.On(MENU_INVOKE_EVENT, (ev) => {
            const data = ev.data
            if (typeof data !== 'string') return
            handler(data)
        })
    },
}
