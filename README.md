# System Monitor

Widget de escritorio ligero para supervisar métricas del equipo local y de un
servidor Linux remoto mediante SSH.

Está construido con Electron, React y TypeScript. La ventana permanece siempre
visible, permite moverse por el escritorio e incluye controles para minimizar y
cerrar completamente la aplicación.

## Funcionalidades

- Métricas locales actualizadas cada 2 segundos:
  - Uso de CPU.
  - RAM activa utilizada, excluyendo caché reutilizable.
  - Temperatura de CPU.
- Monitorización de un servidor Linux remoto mediante SSH:
  - Uso de CPU.
  - RAM utilizada, excluyendo `buff/cache`.
  - Temperatura mediante `sensors` o `thermal_zone0`.
- Gestión de múltiples perfiles SSH.
- Reconexión automática con espera progresiva.
- Widget transparente, flotante y siempre visible.
- Botones para minimizar, cerrar y abrir ajustes.

## Compatibilidad

### Equipo local

La aplicación utiliza [`systeminformation`](https://github.com/sebhildebrandt/systeminformation)
para recopilar las métricas locales.

En macOS con Apple Silicon, cuando `systeminformation` no puede obtener la
temperatura, se utiliza el ejecutable incluido
[`iSMC`](https://github.com/dkorunic/iSMC). Es compatible con Apple Silicon
M1–M5 y no necesita ejecutarse con `sudo`.

### Servidor remoto

El servidor remoto debe:

- Ejecutar Linux.
- Tener SSH habilitado.
- Disponer de los comandos `cat` y `free`.
- Tener opcionalmente `sensors` instalado para una lectura de temperatura más
  precisa.

La aplicación ejecuta remotamente:

```text
cat /proc/stat
free -b
sensors
cat /sys/class/thermal/thermal_zone0/temp
```

## Requisitos de desarrollo

- Node.js 20 o superior.
- npm.
- macOS, Linux o Windows para desarrollar.

## Instalación

```bash
git clone https://github.com/GenRubiio/monitoring.git
cd monitoring
npm install
```

## Uso en desarrollo

```bash
npm start
```

Para añadir un servidor remoto:

1. Abre los ajustes con el botón de engranaje.
2. Introduce nombre, host, puerto, usuario y contraseña.
3. Pulsa **Test** para comprobar la conexión.
4. Guarda el perfil y selecciónalo en el desplegable del widget.

## Comandos disponibles

| Comando | Descripción |
| --- | --- |
| `npm start` | Inicia la aplicación en desarrollo. |
| `npm test` | Ejecuta los tests con Jest. |
| `npm run typecheck` | Comprueba los tipos TypeScript. |
| `npm run lint` | Ejecuta ESLint. |
| `npm run package` | Genera una aplicación empaquetada localmente. |
| `npm run make` | Genera los instaladores configurados para la plataforma. |

Los paquetes generados se guardan dentro de `out/`.

## Arquitectura

```text
src/
├── main/       Proceso principal, métricas, SSH, almacenamiento e IPC
├── preload/    API segura expuesta al renderer
├── renderer/   Interfaz React y estilos
└── shared/     Tipos y nombres de canales IPC compartidos

resources/
└── native/ismc/  Helper nativo para sensores de temperatura de macOS

tests/          Tests unitarios y de integración
```

El renderer está aislado y no tiene acceso directo a Node.js. Todas las
operaciones privilegiadas pasan por una API limitada definida en el preload.

## Cálculo de métricas

- **RAM local:** utiliza memoria activa para no contar caché reutilizable.
- **RAM remota:** utiliza la columna `used` de `free -b`, que excluye
  `buff/cache` en versiones modernas de `free`.
- **Temperatura local:** intenta primero `systeminformation`; en Apple Silicon
  utiliza como fallback `CPU Die Average` de iSMC.
- **Temperatura remota:** intenta primero `sensors` y después
  `/sys/class/thermal/thermal_zone0/temp`.

## Seguridad

> [!WARNING]
> Actualmente las contraseñas SSH se guardan localmente en texto plano mediante
> `electron-store`. No utilices credenciales sensibles o de producción hasta
> implementar almacenamiento cifrado con `safeStorage` o autenticación mediante
> claves SSH.

La ventana utiliza `contextIsolation`, sandbox del renderer y
`nodeIntegration: false`.

## Software de terceros

La aplicación incluye un ejecutable independiente de
[`iSMC`](https://github.com/dkorunic/iSMC), distribuido bajo GPL-3.0. Su
licencia y README originales están disponibles en:

```text
resources/native/ismc/
```

El resto del proyecto está declarado bajo licencia MIT.
