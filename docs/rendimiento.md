# Cómo se consigue que no se entrecorte

Un visor normal de tiles 3D descarga, parsea y sube a GPU **mientras te mueves**. Eso
funciona para una cámara orbital lenta y es injugable a 100 km/h entre edificios. Aquí el
enfoque es el contrario: se paga todo el coste antes de despegar.

1. **Carga por región, no por cámara.** `LoadRegionPlugin` hace que el error geométrico
   dependa de una esfera centrada en tu punto de vuelo, no de dónde mira la cámara. El
   resultado: los tiles de la zona se cargan y se marcan visibles mires donde mires.
2. **Congelar el traversal.** Como el conjunto visible ya no depende de la cámara, en
   cuanto termina la precarga se deja de llamar a `tiles.update()`. Cero descargas, cero
   descartes, cero reevaluación de LOD durante el vuelo. El culling por frustum pasa a
   hacerlo three por objeto (`autoDisableRendererCulling = false`), y las matrices del
   subárbol dejan de recalcularse.
3. **Texturas subidas a mano.** Por defecto una textura llega a la GPU la primera vez que
   se dibuja: con miles de tiles eso es un goteo de micro-tirones durante todo el vuelo.
   Se fuerzan todas con `initTexture` durante la carga, troceado.
4. **Shaders compilados antes.** `compileAsync` sobre el tileset entero, más un barrido
   real de 360° renderizando de verdad antes de devolver el control.
5. **Materiales planos.** Los tiles fotogramétricos ya llevan la luz horneada en la
   textura, así que se cambian a `MeshBasicMaterial`: una sola variante de shader y menos
   trabajo por píxel.
6. **Colisiones O(1).** Nada de raycasts contra la malla. Durante la carga se voxeliza la
   geometría en una rejilla de bits (~2 m, decenas de MB) y colisionar es una consulta de
   coste constante — ~40 ns, medido en los tests. Se voxeliza lo que el tileset **dibuja**,
   no lo que tiene cargado: la caché no descarta nada, así que los tiles ancestros siguen en
   memoria, y son el globo entero resuelto con un par de cientos de triángulos.
7. **Física de paso fijo a 1 kHz**, desacoplada del render y sin asignar memoria en el
   bucle (no hay presión de GC). A 40 m/s el dron avanza 4 cm por subpaso, muy por debajo
   de un vóxel: la detección es continua sin hacer nada especial. El modelo completo
   —Betaflight, cuatro motores, cuatro hélices y el sólido rígido— cuesta 0,09 ms por
   frame a 60 fps, medido en el navegador.
8. **Depth invertido** (`EXT_clip_control`) en vez de depth logarítmico: precisión de
   0,15 m a 40 km sin el coste por vértice. Cae al logarítmico si la GPU no lo soporta.
9. **Caché en disco.** Un service worker guarda los tiles respetando su `Cache-Control`,
   con clave independiente de `key` y `session`. No ahorra dinero (lo facturable es la
   sesión), pero recargar la misma zona pasa de minutos a segundos.

10. **La carga no depende de que mires la pestaña.** Todo lo anterior avanza a trozos,
    cediendo el control entre uno y otro, y ese turno era un frame. El navegador deja de dar
    frames en cuanto la pestaña no se ve, así que la carga se quedaba helada a la mitad —y
    con ella las colas del propio tileset, que difieren su siguiente descarga o parseo de la
    misma forma—. Fuera de la vista el turno lo marca el temporizador de un worker, que el
    navegador no estrangula como estrangula los de la página, y cada turno despierta a mano
    las colas paradas. Una zona grande se puede dejar cargando y volver a por ella.

El OSD lleva un **gráfico de frametime y un contador de tirones** (frames > 24 ms) en la
esquina superior derecha. Si marca 0 tras un vuelo largo, la precarga hizo su trabajo. Si
aparece un pico, algo se quedó fuera.
