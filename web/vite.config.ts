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
})
