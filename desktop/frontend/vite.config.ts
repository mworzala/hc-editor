import generouted from '@generouted/react-router/plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import wails from '@wailsio/runtime/plugins/vite'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
    server: {
        host: '127.0.0.1',
        port: Number(process.env.WAILS_VITE_PORT) || 9245,
        strictPort: true,
        proxy: {
            // Forward API calls to the local Go server so the browser sees them
            // as same-origin and CORS doesn't apply. SSE needs the stream not
            // to be buffered.
            '/v1': {
                target: 'http://localhost:9127',
                changeOrigin: true,
            },
        },
    },
    plugins: [react(), tailwindcss(), generouted(), wails('./bindings')],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
})
