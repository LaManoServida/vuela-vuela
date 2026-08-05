import { defineConfig } from 'vite';

export default defineConfig( {
	server: {
		host: '127.0.0.1',
		port: 5173,
		// El service worker necesita servirse desde la raíz para poder
		// interceptar todas las peticiones de la página.
		headers: {
			'Service-Worker-Allowed': '/',
		},
	},
	build: {
		target: 'esnext',
	},
} );
