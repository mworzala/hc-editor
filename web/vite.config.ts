import generouted from '@generouted/react-router/plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
    plugins: [react(), tailwindcss(), generouted()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
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
})
