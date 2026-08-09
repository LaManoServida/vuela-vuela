# Los ajustes en pestañas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los más de setenta controles del menú dejen de ser una tira vertical y queden repartidos en seis pestañas —Zona, Mando, Vuelo, Aparato, Juego, Imagen—, con el panel de mando dentro de la suya y el bloque de vuelo partido por dentro, sin que cambie ni un ajuste.

**Architecture:** `buildSettings` deja de encadenar `fieldset`s y monta una barra de pestañas más un cuerpo con los seis paneles, todos construidos de una vez y conmutados con `hidden`. Cada panel sale de una función `buildXPanel( … )` que devuelve sus `fieldset`s; las tres que ya existen (vuelo, aparato, juego) se reutilizan y se añaden tres más (zona, entrada, imagen). El panel de mando pasa a montarse dentro de la pestaña «Mando», lo que obliga a `buildSettings` a devolver un `dispose()` que pare su bucle de lectura. `main.js` guarda el objeto devuelto en el menú y en la pausa, recuerda la pestaña de la pausa entre aperturas y la fuerza en los dos casos en que el aviso de pantalla mandaría a un sitio escondido.

**Tech Stack:** JavaScript ESM puro, Vite 8, three.js. Sin dependencias nuevas. Tests caseros en Node (`node tests/*.mjs`, sin framework) con el ayudante `check( nombre, condición, info )`. No hay DOM en los tests: lo que se comprueba de la interfaz se comprueba leyendo el fuente.

**Spec:** `docs/superpowers/specs/2026-08-09-ajustes-en-pestanas-design.md`

## Global Constraints

- **Estilo del repositorio:** tabuladores para indentar, espacios dentro de los paréntesis (`fn( a, b )`), línea en blanco tras la apertura de un bloque de función y antes del cierre, comentarios en castellano que expliquen el *porqué*, no el qué.
- **Ni un ajuste cambia.** Ningún control cambia de nombre visible, de recorrido (`ui.*`), de clave de configuración ni de momento de aplicación. Este plan reparte y renombra bloques; no toca comportamiento.
- **`vuela.config.js` no se toca en ninguna tarea.** Si al empezar hay cambios sin commitear en ese fichero: `git stash push -- vuela.config.js`, hacer la tarea, y devolverlos después.
- **Los seis `id` de pestaña, exactos:** `zona`, `mando`, `vuelo`, `aparato`, `juego`, `imagen`. Son lo que se recuerda entre pausas y lo que aceptan `initialTab` y `showTab`.
- **El panel de mando se monta una vez y no se rehace al cambiar de pestaña.** Lee el gamepad en cada frame; destruirlo y rehacerlo partiría una calibración a medias.
- **Cada tarea acaba con `npm test` en verde y un commit.** Y con push, sin esperar a que lo pidan.

**Desvío consciente del spec:** el spec lista los bloques de «Vuelo» como *Rates, PID, Ajuste fino, Gas y ralentí, Limitador de RPM*. El primero se titula **«Modo y rates»**, porque además de las curvas lleva el selector de modo de vuelo y llamarlo sólo «Rates» mentiría.

---

### Task 1: «Vuelo», partido en cinco bloques

`buildFlightPanel` devuelve hoy un solo `fieldset` con treinta y tantos deslizadores y doce campos de PID seguidos. Pasa a devolver **un array de cinco `fieldset`s**. Los mismos controles, en el mismo orden, con los mismos rangos: lo único que cambia es dónde empieza y acaba cada cosa. Todavía no hay pestañas — al acabar esta tarea el menú sigue siendo una columna, pero con cinco títulos donde había uno.

**Files:**
- Modify: `src/menu.js:355-569` (el cuerpo de `buildFlightPanel`), `src/menu.js:300` (la llamada, que pasa a esparcir el array)

**Interfaces:**
- Consumes: nada.
- Produces: `buildFlightPanel( config, onChange )` devuelve `HTMLFieldSetElement[]` (cinco elementos) en vez de un `HTMLFieldSetElement`. Es el único cambio de contrato de la tarea.

- [ ] **Step 1: Cambiar el `return` de `buildFlightPanel` por los cinco bloques**

En `src/menu.js`, todo lo que hay **antes** del `return` de `buildFlightPanel` (la constante `bf`, `rateNote`, `refreshRates`, `rp`, `pidRows` y la llamada a `refreshRates()`) se queda **exactamente como está**. Sustituye sólo el `return h( 'fieldset', {}, [ … ] );` final por este array. Los `nestedSlider`/`nestedCheckbox`/`nestedSelect` son literalmente los que ya había: no cambies ni un `ui.*` ni un formato.

```js
	return [

		h( 'fieldset', {}, [
			h( 'legend', { text: 'Modo y rates' } ),

			nestedSelect( 'Modo de vuelo', bf, 'mode', [
				{ value: 'acro', label: 'Acro (rate) — FPV de verdad' },
				{ value: 'angle', label: 'Angle — autonivelado' },
				{ value: 'horizon', label: 'Horizon — nivela con el stick centrado' },
			], onChange, 'mode' ),

			nestedSelect( 'Tipo de rates', bf, 'rateType', [
				{ value: 'betaflight', label: 'Betaflight (RC rate + super)' },
				{ value: 'actual', label: 'Actual (centro + máximo)' },
			], () => refreshRates(), 'rates' ),

			h( 'div', { class: 'grid' }, rp ),
			rateNote,
		] ),

		h( 'fieldset', {}, [
			h( 'legend', { text: 'PID' } ),

			h( 'div', { class: 'pid-table' }, pidRows ),
			h( 'p', {
				class: 'note',
				html: 'Los números son los del configurador de Betaflight y se aplican con sus mismas escalas internas. '
					+ '<b>P</b> es la fuerza con que corrige, <b>I</b> lo que aguanta contra el viento, '
					+ '<b>D</b> el amortiguamiento y <b>F</b> lo que se adelanta al stick. Empieza tocando P.',
			} ),

			h( 'div', { class: 'grid' }, [
				nestedSlider( 'Anti-gravity', bf, 'antiGravityGain', {
					...ui.antiGravity,
					format: v => v === 0 ? 'apagado' : v.toFixed( 1 ),
					onChange, notify: 'iterm',
				} ),
				nestedSlider( 'TPA (atenúa P y D con gas alto)', bf, 'tpaRate', {
					...ui.tpaRate,
					format: v => v === 0 ? 'apagada' : `${ Math.round( v * 100 ) } %`,
					onChange, notify: 'tpa',
				} ),
			] ),
			h( 'p', {
				class: 'note',
				text: 'Anti-gravity sube la I mientras el gas cambia deprisa: sin ella el dron '
					+ 'cabecea al dar y quitar gas de golpe.',
			} ),

			h( 'div', { class: 'row', style: 'margin-top:10px' }, [
				nestedCheckbox( 'Airmode', bf, 'airMode', onChange, 'airmode' ),
				nestedCheckbox( 'I-term relax', bf, 'itermRelax', onChange, 'iterm' ),
			] ),
		] ),

		h( 'fieldset', {}, [
			h( 'legend', { text: 'Ajuste fino' } ),
			h( 'p', { class: 'note', style: 'margin-top:0', text: 'Esto casi nunca se toca, pero estaba sólo en el fichero y ahora no.' } ),

			h( 'div', { class: 'grid' }, [
				nestedSlider( 'Expo de yaw', bf, 'rcYawExpo', {
					...ui.rcYawExpo, format: v => v.toFixed( 2 ), onChange, notify: 'rates',
				} ),
				nestedSlider( 'Límite de inclinación (angle)', bf, 'angleLimit', {
					...ui.angleLimit, format: v => `${ v }°`, onChange, notify: 'mode',
				} ),
				nestedSlider( 'Fuerza de autonivelado (angle)', bf, 'angleStrength', {
					...ui.angleStrength, format: v => `${ v }`, onChange, notify: 'mode',
				} ),
				nestedSlider( 'Fuerza de autonivelado (horizon)', bf, 'horizonStrength', {
					...ui.horizonStrength, format: v => `${ v }`, onChange, notify: 'mode',
				} ),
				nestedSlider( 'Gas al que empieza la TPA', bf, 'tpaBreakpoint', {
					...ui.tpaBreakpoint, format: v => `${ Math.round( v * 100 ) } %`, onChange, notify: 'tpa',
				} ),
				nestedSlider( 'Corte del anti-gravity', bf, 'antiGravityCutoffHz', {
					...ui.antiGravityHz, format: v => `${ v } Hz`, onChange, notify: 'iterm',
				} ),
				nestedSlider( 'Corte del I-term relax', bf, 'itermRelaxCutoffHz', {
					...ui.itermRelaxHz, format: v => `${ v } Hz`, onChange, notify: 'iterm',
				} ),
				nestedSlider( 'Anti-windup de la I', bf, 'itermWindup', {
					...ui.itermWindup, format: v => `${ v } % de mezcla`, onChange, notify: 'iterm',
				} ),
				nestedSlider( 'Ganancia de D-min', bf, 'dMinGain', {
					...ui.dMinGain, format: v => `${ v }`, onChange, notify: 'pid',
				} ),
				nestedSlider( 'Adelanto de D-min', bf, 'dMinAdvance', {
					...ui.dMinAdvance, format: v => `${ v }`, onChange, notify: 'pid',
				} ),
				nestedSlider( 'Filtro del giróscopo', bf, 'gyroLpfHz', {
					...ui.gyroLpfHz, format: v => `${ v } Hz`, onChange, notify: 'filtros',
				} ),
				nestedSlider( 'Filtro de la D', bf, 'dtermLpfHz', {
					...ui.dtermLpfHz, format: v => `${ v } Hz`, onChange, notify: 'filtros',
				} ),
				nestedSlider( 'Suavizado del mando', bf, 'rcSmoothingHz', {
					...ui.rcSmoothingHz, format: v => `${ v } Hz`, onChange, notify: 'filtros',
				} ),
				nestedSlider( 'Tope de suma del PID', bf, 'pidSumLimit', {
					...ui.pidSumLimit, format: v => `${ v }`, onChange, notify: 'pid',
				} ),
				nestedSlider( 'Tope de suma en yaw', bf, 'pidSumLimitYaw', {
					...ui.pidSumLimitYaw, format: v => `${ v }`, onChange, notify: 'pid',
				} ),
			] ),
		] ),

		h( 'fieldset', {}, [
			h( 'legend', { text: 'Gas y ralentí' } ),

			h( 'div', { class: 'grid' }, [
				nestedSlider( 'Centro de la curva de gas', bf, 'throttleMid', {
					...ui.throttleMid, format: v => `${ Math.round( v * 100 ) } %`, onChange, notify: 'gas',
				} ),
				nestedSlider( 'Expo de gas', bf, 'throttleExpo', {
					...ui.throttleExpo, format: v => v === 0 ? 'lineal' : v.toFixed( 2 ), onChange, notify: 'gas',
				} ),
				nestedSlider( 'Tope de gas', bf, 'throttleCap', {
					...ui.throttleCap, format: v => `${ Math.round( v * 100 ) } %`, onChange, notify: 'gas',
				} ),
				nestedSlider( 'Ralentí dinámico', bf, 'dynIdleMinRpm', {
					...ui.dynIdleMinRpm, format: v => v === 0 ? 'apagado' : `${ v } RPM`, onChange, notify: 'gas',
				} ),
				nestedSlider( 'Ralentí de los motores', bf, 'motorIdle', {
					...ui.motorIdle, format: v => `${ ( v * 100 ).toFixed( 1 ) } %`, onChange, notify: 'gas',
				} ),
			] ),
			h( 'p', { class: 'note', text: 'El ralentí dinámico sostiene unas vueltas mínimas para que las hélices no se calen al cortar gas: a 0 se apaga, y entonces cortar del todo en pleno ascenso desestabiliza el aparato.' } ),
		] ),

		h( 'fieldset', {}, [
			h( 'legend', { text: 'Limitador de RPM' } ),

			h( 'div', { class: 'row' }, [
				nestedCheckbox( 'Limitador de RPM', bf, 'rpmLimit', onChange, 'rpm' ),
			] ),
			h( 'div', { class: 'grid', style: 'margin-top:10px' }, [
				nestedSlider( 'RPM máximas', bf, 'rpmLimitValue', {
					...ui.rpmLimitValue, format: v => `${ v } RPM`, onChange, notify: 'rpm',
				} ),
				nestedSlider( 'P del limitador', bf, 'rpmLimitP', {
					...ui.rpmLimitGain, format: v => `${ v }`, onChange, notify: 'rpm',
				} ),
				nestedSlider( 'I del limitador', bf, 'rpmLimitI', {
					...ui.rpmLimitGain, format: v => `${ v }`, onChange, notify: 'rpm',
				} ),
				nestedSlider( 'D del limitador', bf, 'rpmLimitD', {
					...ui.rpmLimitGain, format: v => `${ v }`, onChange, notify: 'rpm',
				} ),
				nestedSlider( 'Filtro del limitador', bf, 'rpmLimitLpfHz', {
					...ui.rpmLimitLpfHz, format: v => `${ v } Hz`, onChange, notify: 'rpm',
				} ),
			] ),
			h( 'p', { class: 'note', text: 'Mantiene las vueltas por debajo de un tope, como el gobernador de Betaflight. Apagado en el aparato de referencia.' } ),
		] ),

	];
```

Dos notas cambian de texto a propósito, porque el título del bloque ya dice lo que decían ellas: la del limitador pierde el prefijo «Limitador de RPM:» y la del gas pierde «Curva de gas y ralentí.». La de ajuste fino pasa de «Lo de abajo casi nunca se toca» a «Esto casi nunca se toca», porque ya no está abajo de nada: está dentro de su bloque.

Actualiza también el comentario de cabecera de `buildFlightPanel` para que diga que devuelve varios bloques:

```js
/**
 * Rates y PID, con los mismos nombres y unidades que el configurador de
 * Betaflight: lo que funcione aquí funciona en un dron de verdad y al revés.
 *
 * Devuelve cinco bloques y no uno: son treinta y tantos deslizadores, y de
 * corrido no se distingue dónde acaba el ajuste fino y empieza la curva de gas.
 */
```

- [ ] **Step 2: Esparcir el array en el sitio donde se monta**

En `src/menu.js`, dentro de `buildSettings`, esta línea:

```js
		container.appendChild( buildFlightPanel( config, onChange ) );
```

pasa a ser:

```js
		container.append( ...buildFlightPanel( config, onChange ) );
```

- [ ] **Step 3: Pasar los tests**

Run: `npm test`
Expected: TODO OK. En particular sigue en verde «todos los rangos de ui se usan en el menú», que es el guardián que caza un deslizador perdido al repartir.

- [ ] **Step 4: Mirar que el menú sigue entero**

Run: `npm run dev` y abre el menú.
Expected: donde había un bloque «Mando y controlador» hay cinco —Modo y rates, PID, Ajuste fino, Gas y ralentí, Limitador de RPM— con exactamente los mismos controles y ninguno repetido ni ausente.

- [ ] **Step 5: Commit**

```bash
git add src/menu.js
git commit -m "$(cat <<'EOF'
refactor: el bloque de vuelo deja de ser una tirada de treinta deslizadores

Rates, PID, ajuste fino, curva de gas y limitador de RPM iban seguidos, sin
más separación que dos o tres notas sueltas, así que no había forma de ver
dónde acababa una cosa y empezaba la siguiente.

Los mismos controles en el mismo orden, repartidos en cinco bloques con
título. Tres notas pierden el trozo que ahora dice el título.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 2: `h` sale a su propio módulo

`gamepadPanel.js` importa `h` de `menu.js`. En la tarea siguiente `menu.js` va a importar `buildGamepadPanel` de `gamepadPanel.js`, y eso cierra un ciclo. ESM lo aguantaría —las dos son funciones declaradas y sólo se llaman en tiempo de ejecución— pero es exactamente el tipo de dependencia que se rompe sola cuando alguien mueve una línea. `h` no es del menú: es un ayudante de DOM que usan los dos.

Tarea puramente mecánica: al acabar, el juego se comporta igual y los tests dicen lo mismo.

**Files:**
- Create: `src/dom.js`
- Modify: `src/menu.js:1-24` (sale `h`, entra el import), `src/menu.js:750` (se borra `export { h };`)
- Modify: `src/gamepadPanel.js:2` (el import cambia de fichero)

**Interfaces:**
- Consumes: nada.
- Produces: `src/dom.js` exporta `h( tag, attrs = {}, children = [] )` con exactamente el mismo comportamiento que tenía en `menu.js`. `menu.js` deja de exportar `h`.

- [ ] **Step 1: Crear `src/dom.js` con `h` movido tal cual**

```js
/*
 * El ayudante de DOM que usan el menú y el panel de mando.
 *
 * Vive aparte de los dos porque los dos lo necesitan: tenerlo en `menu.js` y
 * que `gamepadPanel.js` lo importara de ahí obligaba a que la dependencia
 * fuera en un solo sentido, y desde que el panel de mando se monta dentro de
 * los ajustes tiene que ir en los dos.
 */
export function h( tag, attrs = {}, children = [] ) {

	const el = document.createElement( tag );
	for ( const [ k, v ] of Object.entries( attrs ) ) {

		if ( k === 'class' ) el.className = v;
		else if ( k === 'text' ) el.textContent = v;
		else if ( k === 'html' ) el.innerHTML = v;
		else if ( k.startsWith( 'on' ) ) el.addEventListener( k.slice( 2 ).toLowerCase(), v );
		else if ( v !== null && v !== undefined && v !== false ) el.setAttribute( k, v === true ? '' : v );

	}

	for ( const child of [].concat( children ) ) {

		if ( child ) el.appendChild( typeof child === 'string' ? document.createTextNode( child ) : child );

	}

	return el;

}
```

- [ ] **Step 2: Quitarlo de `menu.js` y traerlo por import**

En `src/menu.js`, borra la función `h` entera (líneas 3-24) y la línea `export { h };` del final del fichero. La primera línea del fichero pasa de:

```js
import { ui } from './config.js';
```

a:

```js
import { ui } from './config.js';
import { h } from './dom.js';
```

- [ ] **Step 3: Apuntar `gamepadPanel.js` al fichero nuevo**

En `src/gamepadPanel.js`, línea 2:

```js
import { h } from './menu.js';
```

pasa a:

```js
import { h } from './dom.js';
```

- [ ] **Step 4: Comprobar que nadie más importaba `h` de `menu.js`**

Run: `grep -rn "from './menu.js'\|from './dom.js'" src/`
Expected: `gamepadPanel.js` y `menu.js` importan de `dom.js`; `main.js` importa de `menu.js` sólo los constructores. Ningún otro fichero pide `h` a `menu.js`.

- [ ] **Step 5: Pasar los tests**

Run: `npm test`
Expected: TODO OK, sin cambios respecto a la tarea anterior. Ojo a «ningún min/max/step literal en menu.js» y «todos los rangos de ui se usan en el menú»: ambos leen el fuente de `menu.js` y `h` no aportaba nada a ninguno de los dos, así que deben seguir igual.

- [ ] **Step 6: Mirar que el juego arranca**

Run: `npm run dev`
Expected: el menú se pinta entero y el panel de mando también. Si `h` se hubiera quedado a medias, no se pintaría nada y la consola lo diría.

- [ ] **Step 7: Commit**

```bash
git add src/dom.js src/menu.js src/gamepadPanel.js
git commit -m "$(cat <<'EOF'
refactor: el ayudante de DOM deja de vivir dentro del menú

`h` lo usan el menú y el panel de mando, y estaba en el menú: el panel tenía
que importarlo de ahí. Eso obligaba a que la dependencia entre los dos fuera
en un solo sentido, y el panel está a punto de montarse dentro de los
ajustes, con lo que tiene que ir en los dos.

Movido a `src/dom.js` sin tocar una línea de su cuerpo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 3: Las seis pestañas

El grueso. `buildSettings` monta barra y cuerpo, cada pestaña sale de su propia función, el panel de mando entra en «Mando» y `main.js` deja de montarlo por su cuenta.

**Files:**
- Modify: `src/menu.js` (`buildSettings` entero, tres funciones nuevas de panel, `buildMenu`/`buildPauseSettings` se van)
- Modify: `src/main.js:12-13` (imports), `src/main.js:30` (fuera `pauseGamepad` del `dom`), `src/main.js:48` (las variables de estado), `src/main.js:386-407` (`openPause`/`closePause`), `src/main.js:730-738` (`setupMenu`)
- Modify: `src/styles.css` (bloque nuevo de pestañas, tras la regla de `legend`)
- Modify: `index.html:87` (fuera `<div id="pause-gamepad"></div>`)
- Modify: `tests/config.test.mjs` (guardián del hueco que se quita)

**Interfaces:**
- Consumes: `buildFlightPanel( config, onChange ) → HTMLFieldSetElement[]` (Task 1); `h` desde `./dom.js` (Task 2).
- Produces:
  - `buildSettings( container, config, { onChange, onEstimate, onVoxelSize, input, onGamepadChange, initialTab } ) → { refreshEstimate(), showTab( id ), get tab(), dispose() }`. Es la única entrada del módulo: `buildMenu` y `buildPauseSettings` desaparecen.
  - `buildZonePanel( config, onChange, onEstimate ) → { rows: HTMLFieldSetElement[], refreshEstimate() }`
  - `buildInputPanel( config, onChange ) → HTMLFieldSetElement`
  - `buildImagePanel( config, onChange ) → HTMLFieldSetElement`

- [ ] **Step 1: Sacar zona, entrada e imagen a sus propias funciones**

En `src/menu.js`, después de `buildHardwarePanel`, añade estas tres. El contenido es el que hoy está dentro de `buildSettings`, movido sin cambiar un control.

```js
/**
 * La cuenta de Google y dónde se vuela. Devuelve también con qué refrescar la
 * estimación de carga, que la pide el menú de arranque cada vez que se mueve el
 * radio o la calidad.
 */
export function buildZonePanel( config, onChange, onEstimate ) {

	const keyInput = h( 'input', {
		type: 'text',
		placeholder: 'AIza…',
		value: config.apiKey,
		spellcheck: 'false',
		oninput: e => {

			config.apiKey = e.target.value.trim();
			onChange?.( 'apiKey' );

		},
	} );

	const account = h( 'fieldset', {}, [
		h( 'legend', { text: 'Cuenta de Google' } ),
		field( 'API key de Google Maps Platform (Map Tiles API)', keyInput ),
		h( 'p', { class: 'note', html: 'Cada arranque consume <b>1</b> de las 1.000 peticiones de "root tileset" gratuitas al mes. Los tiles que se descarguen después no se facturan aparte. Ver <code>README.md</code> para crear la clave.' } ),
	] );

	const placeGrid = h( 'div', { class: 'places' } );
	const latInput = h( 'input', { type: 'number', step: ui.lat.step, value: config.lat } );
	const lonInput = h( 'input', { type: 'number', step: ui.lon.step, value: config.lon } );

	const syncPlaceSelection = () => {

		for ( const btn of placeGrid.children ) {

			btn.classList.toggle( 'sel', btn.dataset.id === config.placeId );

		}

	};

	for ( const place of config.places ) {

		placeGrid.appendChild( h( 'button', {
			class: 'place',
			'data-id': place.id,
			onclick: () => {

				config.placeId = place.id;
				config.lat = place.lat;
				config.lon = place.lon;
				latInput.value = place.lat;
				lonInput.value = place.lon;
				syncPlaceSelection();
				onChange?.( 'place' );

			},
		}, [ place.name, h( 'small', { text: place.hint } ) ] ) );

	}

	syncPlaceSelection();

	const onCoord = () => {

		config.lat = parseFloat( latInput.value );
		config.lon = parseFloat( lonInput.value );
		config.placeId = 'custom';
		syncPlaceSelection();
		onChange?.( 'coords' );

	};

	latInput.addEventListener( 'change', onCoord );
	lonInput.addEventListener( 'change', onCoord );

	const estimate = h( 'p', { class: 'note' } );
	const refreshEstimate = () => {

		estimate.textContent = onEstimate?.() || '';

	};

	const zone = h( 'fieldset', {}, [
		h( 'legend', { text: 'Zona de vuelo' } ),
		placeGrid,
		h( 'div', { class: 'grid', style: 'margin-top:12px' }, [
			field( 'Latitud', latInput ),
			field( 'Longitud', lonInput ),
		] ),
		h( 'div', { class: 'grid', style: 'margin-top:6px' }, [
			labelledSlider( 'Radio a máximo detalle', config, 'radius', {
				...ui.radius,
				format: v => `${ v } m`,
				onChange: () => { refreshEstimate(); onChange?.( 'radius' ); },
			} ),
			labelledSlider( 'Calidad (menor = más detalle)', config, 'quality', {
				...ui.quality,
				format: v => `${ v }`,
				onChange: () => { refreshEstimate(); onChange?.( 'quality' ); },
			} ),
			labelledSlider( 'Altura de aparición', config, 'spawnHeight', {
				...ui.spawnHeight,
				format: v => `${ v } m`,
			} ),
		] ),
		estimate,
		h( 'p', { class: 'note', text: 'La zona se congela al cargarla: cambiar esto en pausa no afecta al vuelo en curso, se aplica la próxima vez que cargues.' } ),
	] );

	refreshEstimate();

	return { rows: [ account, zone ], refreshEstimate };

}

/** Lo que hay entre el stick y el modelo. Acompaña al panel de mando. */
export function buildInputPanel( config, onChange ) {

	return h( 'fieldset', {}, [
		h( 'legend', { text: 'Entrada' } ),
		h( 'div', { class: 'grid' }, [
			labelledSlider( 'Zona muerta de los sticks', config, 'deadzone', {
				...ui.deadzone,
				format: v => v === 0 ? 'sin zona muerta' : `${ ( v * 100 ).toFixed( 0 ) } %`,
				onChange,
			} ),
		] ),
		h( 'p', { class: 'note', text: 'Cuánto hay que mover un stick desde el centro para que empiece a contar. Súbela sólo si el mando tiembla en reposo: de más, se come la precisión alrededor del centro, que es donde se vuela.' } ),
	] );

}

/** Lo que se ve por la cámara. Nada de esto toca el vuelo. */
export function buildImagePanel( config, onChange ) {

	return h( 'fieldset', {}, [
		h( 'legend', { text: 'Imagen' } ),
		h( 'div', { class: 'grid' }, [
			labelledSlider( 'FOV', config, 'fov', {
				...ui.fov, format: v => `${ v }°`, onChange,
			} ),
			labelledSlider( 'Inclinación de cámara', config, 'camTilt', {
				...ui.camTilt, format: v => `${ v }°`, onChange,
			} ),
			labelledSlider( 'Escala de render', config, 'renderScale', {
				...ui.renderScale, format: v => `${ Math.round( v * 100 ) }%`, onChange,
			} ),
			labelledSlider( 'Niebla', config, 'fogDensity', {
				...ui.fogDensity, format: v => v.toFixed( 1 ), onChange,
			} ),
		] ),
		h( 'div', { class: 'row', style: 'margin-top:10px' }, [
			checkbox( 'Antialiasing', config, 'antialias', onChange ),
			checkbox( 'Materiales planos (recomendado)', config, 'unlit', onChange ),
		] ),
		h( 'p', { class: 'note', text: 'Los materiales planos se cambian en el sitio, sobre lo que ya está descargado. El antialiasing no puede: se fija al crear el contexto de vídeo, así que al reanudar se recarga la zona sola —y eso cuesta una de las 1.000 sesiones gratuitas del mes.' } ),
	] );

}
```

- [ ] **Step 2: Reescribir `buildSettings` con la barra de pestañas**

En `src/menu.js`, importa el panel de mando debajo del import de `dom.js`:

```js
import { buildGamepadPanel } from './gamepadPanel.js';
```

Sustituye `buildSettings` entera (desde su comentario de cabecera hasta su `}`) por esto:

```js
/**
 * Las seis pestañas, en orden. El `id` es lo que se recuerda entre pausas y lo
 * que aceptan `initialTab` y `showTab`; la etiqueta es lo que se lee.
 */
const TABS = [
	{ id: 'zona', label: 'Zona' },
	{ id: 'mando', label: 'Mando' },
	{ id: 'vuelo', label: 'Vuelo' },
	{ id: 'aparato', label: 'Aparato' },
	{ id: 'juego', label: 'Juego' },
	{ id: 'imagen', label: 'Imagen' },
];

/**
 * Todos los ajustes, repartidos en pestañas.
 *
 * Hay un solo constructor y lo usan los dos sitios —el menú de arranque y la
 * pausa—, porque tener dos listas distintas garantizaba que una de las dos se
 * quedara vieja: la mitad de los ajustes sólo se podían tocar cerrando el juego
 * y editando el fichero, que es justo lo que no queremos. Lo que no se puede
 * aplicar en caliente tampoco se esconde: se muestra con su aviso al lado.
 *
 * Las seis se montan de una vez y se conmutan con `hidden`. Cambiar de pestaña
 * no reconstruye nada, y sobre todo no reconstruye el panel de mando, que lee
 * el gamepad en cada frame: rehacerlo a cada clic partiría una calibración a
 * medias. Ese bucle es la razón de que esto devuelva `dispose`.
 */
export function buildSettings( container, config, {
	onChange, onEstimate, onVoxelSize, input, onGamepadChange, initialTab,
} = {} ) {

	container.replaceChildren();

	const zone = buildZonePanel( config, onChange, onEstimate );

	// Sin `input` no hay a quién leer: el panel de mando no se monta y la
	// pestaña se queda con la zona muerta a secas. No pasa hoy en ningún sitio,
	// pero montar medio panel contra `undefined` sería peor.
	const gamepadHost = h( 'div' );
	const gamepad = input
		? buildGamepadPanel( gamepadHost, config, input, { onChange: onGamepadChange } )
		: null;

	const content = {
		zona: zone.rows,
		mando: [ gamepadHost, buildInputPanel( config, onChange ) ],
		vuelo: buildFlightPanel( config, onChange ),
		aparato: [ buildHardwarePanel( config, onChange ) ],
		juego: [ buildGamePanel( config, onChange, onVoxelSize ) ],
		imagen: [ buildImagePanel( config, onChange ) ],
	};

	const panes = {};
	const buttons = {};
	let active = null;

	const showTab = id => {

		if ( ! panes[ id ] ) return;

		active = id;
		for ( const tab of TABS ) {

			panes[ tab.id ].hidden = tab.id !== id;
			buttons[ tab.id ].classList.toggle( 'sel', tab.id === id );
			buttons[ tab.id ].setAttribute( 'aria-selected', String( tab.id === id ) );

		}

	};

	const bar = h( 'div', { class: 'tabs', role: 'tablist' } );
	const body = h( 'div' );

	for ( const tab of TABS ) {

		buttons[ tab.id ] = h( 'button', {
			class: 'tab', type: 'button', role: 'tab', text: tab.label,
			onclick: () => showTab( tab.id ),
		} );
		panes[ tab.id ] = h( 'div', { role: 'tabpanel' }, content[ tab.id ] );

		bar.appendChild( buttons[ tab.id ] );
		body.appendChild( panes[ tab.id ] );

	}

	container.append( bar, body );
	showTab( panes[ initialTab ] ? initialTab : TABS[ 0 ].id );

	return {
		refreshEstimate: zone.refreshEstimate,
		showTab,
		get tab() {

			return active;

		},
		dispose() {

			gamepad?.dispose();

		},
	};

}
```

- [ ] **Step 3: Borrar `buildMenu` y `buildPauseSettings`**

Al final de `src/menu.js`, borra las dos funciones enteras con sus comentarios (hoy en las líneas 724-748, tras el separador `// ---…---`) y el separador que las precede. Con opciones en vez de posicionales eran dos alias idénticos de `buildSettings`; lo que decían sus comentarios se ha repartido entre la cabecera de `buildSettings` y los dos sitios que la llaman.

- [ ] **Step 4: Estilar la barra en `src/styles.css`**

Justo después de la regla de `legend` (línea 94), añade:

```css
.tabs {
	display: flex;
	gap: 2px;
	margin: 0 0 14px;
	border-bottom: 1px solid var(--line);
	overflow-x: auto;
	scrollbar-width: thin;
}
/* Sin envolver a dos filas: una barra que se reordena sola cambia de sitio las
   cosas entre visitas, que es justo lo que las pestañas venían a arreglar. */
.tabs button.tab {
	flex: 0 0 auto;
	background: none;
	border: 0;
	border-bottom: 2px solid transparent;
	border-radius: 0;
	padding: 8px 14px;
	color: var(--dim);
	font-size: 13px;
	font-weight: 600;
}
.tabs button.tab:hover { background: rgba(255, 255, 255, 0.06); color: var(--fg); }
.tabs button.tab.sel { color: var(--accent); border-bottom-color: var(--accent); }
```

- [ ] **Step 5: Quitar el hueco del panel de mando del HTML**

En `index.html`, dentro del bloque de pausa, borra la línea:

```html
			<div id="pause-gamepad"></div>
```

- [ ] **Step 6: Rehacer el cableado de `main.js`**

Cambia el import (líneas 12-13): desaparece el de `gamepadPanel.js`, que ya no monta nadie desde aquí.

```js
import { buildSettings } from './menu.js';
```

En el objeto `dom`, borra la línea `pauseGamepad: document.getElementById( 'pause-gamepad' ),`.

Sustituye la declaración `let pauseGamepad = null;   // panel de mapeo montado en la pausa` por:

```js
let menuSettings = null;   // los ajustes del menú de arranque, montados una vez
let pauseSettings = null;  // los de la pausa, que se rehacen en cada apertura
let pauseTab = 'zona';     // la pestaña donde dejaste la pausa, mientras dure la página
```

`openPause` pasa a ser:

```js
/**
 * Monta la pantalla de pausa. El panel de mando va aquí y no sólo en el menú
 * principal a propósito: llegar al menú desde el vuelo es «Cambiar de zona», que
 * descarga el mundo, y quedarse sin mando no puede costar una descarga entera.
 *
 * Con `onVoxelSize`, al revés que el menú: aquí sí hay zona cargada, así que se
 * puede decir qué resolución de rejilla va a caber de verdad.
 */
function openPause() {

	dom.pause.hidden = false;

	pauseSettings?.dispose();
	pauseSettings = buildSettings( dom.pauseSettings, config, {
		onChange: onLiveSettingChange,
		onVoxelSize: realVoxelSize,
		input,
		onGamepadChange: refreshResume,
		initialTab: pauseTab,
	} );

	refreshResume();

}
```

`closePause` pasa a ser:

```js
function closePause() {

	dom.pause.hidden = true;

	// Antes de soltarlo, quedarse con dónde lo dejó: si estaba afinando el PID,
	// la próxima pausa abre en «Vuelo» y no le hace volver a buscarlo.
	if ( pauseSettings ) pauseTab = pauseSettings.tab;
	pauseSettings?.dispose();
	pauseSettings = null;

}
```

`setupMenu` pasa a ser:

```js
function setupMenu() {

	// No hay `onChange` de persistencia: la configuración vive en
	// `vuela.config.js` y el menú sólo edita la copia en memoria.
	//
	// Y sin `onVoxelSize`: aquí todavía no hay zona cargada, así que no hay caja
	// que medir y no se puede saber qué resolución cabrá. El deslizador enseña lo
	// pedido a secas, que es lo único cierto en ese momento.
	menuSettings = buildSettings( dom.menuBody, config, {
		onEstimate: estimateText,
		input,
	} );

}
```

- [ ] **Step 7: Guardián de que el hueco no vuelve**

En `tests/config.test.mjs`, justo antes del bloque `== el vuelo por ratón y teclado no vuelve ==`, añade:

```js
console.log( '\n== el panel de mando vive dentro de los ajustes ==' );

// Tuvo hueco propio en la pausa y se montaba aparte desde `main.js`. Ahora es
// el contenido de la pestaña «Mando», y si alguien devuelve el hueco tendremos
// dos sitios donde montarlo y uno de los dos se quedará viejo.
const htmlSource = await ( await import( 'node:fs/promises' ) ).readFile(
	new URL( '../index.html', import.meta.url ), 'utf8' );

check( 'sin hueco suelto para el panel de mando',
	! htmlSource.includes( 'pause-gamepad' ) && ! mainSource.includes( 'pause-gamepad' ) );

// El bucle de lectura del gamepad ahora lo para `buildSettings`, y la pausa lo
// rehace en cada apertura: sin este `dispose` se queda un bucle vivo por pausa.
check( 'la pausa suelta los ajustes al cerrarse',
	/pauseSettings\?\.dispose\(\)/.test( mainSource ) );
```

`mainSource` ya está declarado más arriba en el fichero (junto a `worldSource`), así que no lo declares otra vez.

- [ ] **Step 8: Pasar los tests**

Run: `npm test`
Expected: TODO OK, con los dos `check` nuevos en verde. Si «todos los rangos de ui se usan en el menú» falla, es que un deslizador se ha perdido al repartir: el nombre que sale es el `ui.*` huérfano.

- [ ] **Step 9: Mirar que las pestañas funcionan**

Run: `npm run dev`
Expected, en el menú de arranque:
- Seis pestañas: Zona, Mando, Vuelo, Aparato, Juego, Imagen. Abre en «Zona».
- Ninguna vacía, y en ninguna hay algo que no le toque. La estimación de carga sigue actualizándose al mover el radio o la calidad.
- «Mando» enseña el panel de mando con sus barras moviéndose, y debajo la zona muerta.

Y en la pausa (`Esc` desde el vuelo, o desde la ciudad de prueba):
- Las mismas seis, y la que dejaste abierta es la que sale al volver a pausar.
- Pasearse por las otras y volver a «Mando» no corta las barras del gamepad.

- [ ] **Step 10: Commit**

```bash
git add src/menu.js src/main.js src/styles.css index.html tests/config.test.mjs
git commit -m "$(cat <<'EOF'
feat: los ajustes, en seis pestañas

Desde que ningún ajuste vive sólo en el fichero, el menú eran más de setenta
controles en una tira vertical: para tocar el FOV había que pasar por delante
de los cinco PID del limitador de RPM.

Zona, Mando, Vuelo, Aparato, Juego e Imagen. Ni un ajuste cambia de nombre,
de recorrido ni de momento de aplicación; lo único que cambia es dónde está.

El panel de mando deja de montarse aparte —tenía hueco propio en la pausa y se
colgaba a mano en el menú— y pasa a ser el contenido de su pestaña, junto a la
zona muerta. Como lee el gamepad en cada frame y no se puede rehacer a cada
clic, se monta una vez y se esconde: por eso los ajustes ahora se sueltan al
cerrar la pausa, que si no dejaría un bucle vivo por cada una.

El menú abre en «Zona» y se queda donde lo dejes. La pausa recuerda la suya
mientras dure la página.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 4: Los dos avisos que mandan a una pestaña escondida

Hay dos mensajes que apuntan a un control concreto. Con las pestañas puestas, ese control puede no estar a la vista, y entonces el mensaje manda a un sitio que no existe. Las dos pestañas se fuerzan.

**Files:**
- Modify: `src/main.js` (`openPause` y el chequeo de API key de `loadAndFly`)

**Interfaces:**
- Consumes: `showTab( id )` y la opción `initialTab` de `buildSettings` (Task 3); `input.hasControl`, que ya existe.
- Produces: nada nuevo.

- [ ] **Step 1: Pausa sin mando, en «Mando»**

El aviso de `refreshResume` dice «mapea los cuatro ejes **aquí abajo**». En `openPause`, cambia la línea del `initialTab`:

```js
		initialTab: pauseTab,
```

por:

```js
		// El aviso de la pausa manda a mapear los cuatro ejes: la pestaña que los
		// tiene no puede quedarse detrás de otra.
		initialTab: input.hasControl ? pauseTab : 'mando',
```

- [ ] **Step 2: Cargar sin API key, en «Zona»**

En `loadAndFly`, el bloque que hoy es:

```js
	if ( ! demo && ! config.apiKey ) {

		dom.menuNote.textContent = 'Falta la API key de Google Maps Platform. Si sólo quieres probar los mandos y los fps, usa "Volar en la ciudad de prueba".';
		return;

	}
```

pasa a:

```js
	if ( ! demo && ! config.apiKey ) {

		// El aviso sale al pie del menú y señala un campo que puede estar detrás
		// de otra pestaña. Sacarlo a la vista es parte del aviso.
		menuSettings?.showTab( 'zona' );
		dom.menuNote.textContent = 'Falta la API key de Google Maps Platform. Si sólo quieres probar los mandos y los fps, usa "Volar en la ciudad de prueba".';
		return;

	}
```

- [ ] **Step 3: Pasar los tests**

Run: `npm test`
Expected: TODO OK.

- [ ] **Step 4: Mirar los dos saltos**

Run: `npm run dev`

Sin mando conectado (o desconectándolo en vuelo, que pausa solo): la pausa abre en «Mando» aunque la hubieras dejado en otra, y el aviso de arriba —«mapea los cuatro ejes aquí abajo»— señala a algo que se ve.

Con el campo de API key vacío: vete a la pestaña «Imagen», dale a «Cargar zona y volar», y el menú tiene que saltar a «Zona» con el aviso al pie.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "$(cat <<'EOF'
fix: los dos avisos que señalaban a una pestaña escondida

«Mapea los cuatro ejes aquí abajo» y «falta la API key» apuntan a un control
concreto, y con las pestañas ese control puede no estar a la vista. Ahora cada
uno saca la suya: la pausa sin mando abre en «Mando», y cargar zona sin clave
salta a «Zona».

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Qué queda por mirar volando

Lo que `npm test` no puede ver, porque no hay DOM en los tests:

- Que las seis pestañas se pinten bien y ninguna se haya quedado vacía o con algo que no le toca.
- Que la barra no se parta en dos filas al estrechar la ventana, sino que haga scroll horizontal.
- Que una calibración empezada en «Mando» no se corte al pasear por las demás pestañas y volver.
- **Que abrir y cerrar la pausa veinte veces seguidas no vaya comiéndose los fps.** Es lo único que delataría un bucle de lectura del gamepad sin parar, y es el riesgo propio de este cambio: el panel de mando pasó de tener quien lo parara explícitamente a depender de que los ajustes se suelten al cerrar la pausa.
