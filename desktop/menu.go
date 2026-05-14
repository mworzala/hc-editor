package main

import (
	"sort"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// MenuInvokeEvent is the custom event name emitted when a native menu item is
// clicked. The data is the originating action id (string) — the frontend
// runs the action through its registry, applying context filtering.
const MenuInvokeEvent = "menu:invoke"

// MenuSetItemsEvent is the custom event name the frontend uses to push the
// current dynamic-menu payload. Each emit replaces the dynamic section of
// every submenu atomically.
const MenuSetItemsEvent = "menu:set-items"

// MenuItemPayload is the wire-format for a single native menu item, built
// frontend-side from a registered Action.
type MenuItemPayload struct {
	Path        string `json:"path"`
	ActionId    string `json:"actionId"`
	Label       string `json:"label"`
	Group       string `json:"group"`
	Order       int    `json:"order"`
	Accelerator string `json:"accelerator"`
	Enabled     bool   `json:"enabled"`
}

// SetItemsPayload wraps a list of items for the MenuSetItemsEvent.
type SetItemsPayload struct {
	Items []MenuItemPayload `json:"items"`
}

// menuPaths is the canonical ordering of the top-level dynamic submenus.
// Window menu (a Wails role) is inserted between View and Help.
var menuPaths = []string{"file", "edit", "view", "help"}

// menuLabels maps a path to its display label.
var menuLabels = map[string]string{
	"file": "File",
	"edit": "Edit",
	"view": "View",
	"help": "Help",
}

// BuildAppMenu builds the initial native menu with empty dynamic sections.
// Called once at startup so the macOS App menu (About / Hide / Quit) and the
// clipboard roles are present before the frontend boots.
func BuildAppMenu(app *application.App) *application.Menu {
	return buildMenu(app, nil)
}

// RebuildAppMenu swaps the entire application menu with one built from the
// supplied dynamic items. The Wails MenuItem API has no public remove
// operation, so the simplest safe path is to construct a fresh tree.
func RebuildAppMenu(app *application.App, items []MenuItemPayload) {
	app.Menu.SetApplicationMenu(buildMenu(app, items))
}

// buildMenu produces a fresh menu tree consisting of:
//
//   - The macOS App menu role (About, Services, Hide/Others/Unhide, Quit).
//   - For each path in menuPaths: a submenu. The Edit submenu has clipboard
//     roles up top (Undo, Redo, separator, Cut, Copy, Paste, Select All)
//     followed by a separator before any dynamic items, so Cmd+C/V/X work
//     from launch regardless of whether the frontend has pushed items yet.
//     The Window role is slotted in between View and Help.
//
// Dynamic items are filtered per submenu, sorted by (group, order, label),
// and visually separated when `group` changes between adjacent items.
func buildMenu(app *application.App, items []MenuItemPayload) *application.Menu {
	menu := app.Menu.New()
	menu.AddRole(application.AppMenu)

	for _, path := range menuPaths {
		if path == "help" {
			menu.AddRole(application.WindowMenu)
		}
		sub := menu.AddSubmenu(menuLabels[path])
		if path == "edit" {
			sub.AddRole(application.Undo)
			sub.AddRole(application.Redo)
			sub.AddSeparator()
			sub.AddRole(application.Cut)
			sub.AddRole(application.Copy)
			sub.AddRole(application.Paste)
			sub.AddRole(application.SelectAll)
		}
		addDynamicItems(sub, app, filterByPath(items, path), path == "edit")
	}

	return menu
}

// filterByPath returns items belonging to the given submenu, pre-sorted by
// (group, order, label). The frontend already sorts, but resort defensively
// in case any item somehow arrives out of order — sort.SliceStable keeps the
// per-key tie-break deterministic.
func filterByPath(items []MenuItemPayload, path string) []MenuItemPayload {
	out := make([]MenuItemPayload, 0, len(items))
	for _, item := range items {
		if item.Path == path {
			out = append(out, item)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Group != out[j].Group {
			return out[i].Group < out[j].Group
		}
		if out[i].Order != out[j].Order {
			return out[i].Order < out[j].Order
		}
		return out[i].Label < out[j].Label
	})
	return out
}

// addDynamicItems appends the given items to sub, inserting separators between
// groups. When `needsLeadingSeparator` is true and at least one item is
// being added, a separator is inserted first to divide static roles from
// dynamic items.
func addDynamicItems(sub *application.Menu, app *application.App, items []MenuItemPayload, needsLeadingSeparator bool) {
	if len(items) == 0 {
		return
	}
	if needsLeadingSeparator {
		sub.AddSeparator()
	}
	prevGroup := items[0].Group
	for i, item := range items {
		if i > 0 && item.Group != prevGroup {
			sub.AddSeparator()
			prevGroup = item.Group
		}
		mi := sub.Add(item.Label)
		if item.Accelerator != "" {
			mi.SetAccelerator(item.Accelerator)
		}
		mi.SetEnabled(item.Enabled)
		actionId := item.ActionId
		mi.OnClick(func(_ *application.Context) {
			app.Event.Emit(MenuInvokeEvent, actionId)
		})
	}
}
