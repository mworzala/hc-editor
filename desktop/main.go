package main

import (
	"embed"
	_ "embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func init() {
	// Go → frontend: a native menu item was clicked. Data is the originating
	// action id; the frontend resolves it through the action registry.
	application.RegisterEvent[string](MenuInvokeEvent)
	// Frontend → Go: replace the dynamic menu items wholesale.
	application.RegisterEvent[SetItemsPayload](MenuSetItemsEvent)
}

// main function serves as the application's entry point. It initializes the application, creates a window,
// and starts a goroutine that emits a time-based event every second. It subsequently runs the application and
// logs any error that might occur.
func main() {

	// Create a new Wails application by providing the necessary options.
	// Variables 'Name' and 'Description' are for application metadata.
	// 'Assets' configures the asset server with the 'FS' variable pointing to the frontend files.
	// 'Bind' is a list of Go struct instances. The frontend has access to the methods of these instances.
	// 'Mac' options tailor the application when running an macOS.
	app := application.New(application.Options{
		Name:        "Hollow Cube",
		Description: "A demo of using raw HTML & CSS",
		Services:    []application.Service{},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Menu.SetApplicationMenu(BuildAppMenu(app))

	// Listen for dynamic-menu updates from the frontend. The frontend
	// computes the desired item list from the action registry + context
	// set and pushes it here; we swap the application menu wholesale.
	// NSMenu calls must happen on the main thread, but event listeners
	// fire on a goroutine — so the rebuild has to be dispatched via
	// InvokeAsync.
	app.Event.On(MenuSetItemsEvent, func(e *application.CustomEvent) {
		payload, ok := e.Data.(SetItemsPayload)
		if !ok {
			log.Printf("menu:set-items: unexpected data type %T", e.Data)
			return
		}
		application.InvokeAsync(func() {
			RebuildAppMenu(app, payload.Items)
		})
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "Window 1",
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 38,
			TitleBar: application.MacTitleBar{
				AppearsTransparent:   true,
				Hide:                 false,
				HideTitle:            true,
				FullSizeContent:      true,
				UseToolbar:           true,
				ToolbarStyle:         application.MacToolbarStyleUnifiedCompact,
				HideToolbarSeparator: false,
			},
		},
		BackgroundColour: application.NewRGB(27, 38, 54),
		URL:              "/",
	})

	err := app.Run()
	if err != nil {
		log.Fatal(err)
	}
}
